import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store,ideaInput,roles} from '../server/store.mjs';
import {reviewPacket} from '../server/review.mjs';
import {canonicalWorkspacePath} from '../server/workspace-routes.mjs';

async function setup(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'forge-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const store=new Store(root,['LastResort','Other']);
  const save=async(action,payload,profile='LastResort')=>store.command(profile,{action,payload,requestId:randomUUID(),expectedRevision:(await store.read(profile)).revision});
  return {store,save,root};
}
const proposal=(kind,idea,fields)=>({role:roles[0],kind,targetId:idea?.id??'',targetVersion:idea?.version,rationale:'Controlled recommendation',proposal:fields});

test('capture defaults unknown, validates labels and preserves original text and history',async t=>{
  const {save}=await setup(t);
  let state=await save('idea.create',{fields:{title:'A thought',projects:['Project','Project'],tags:['test']}});
  const idea=state.ideas[0];assert.equal(idea.value,'unknown');assert.deepEqual(idea.projects,['Project']);
  state=await save('idea.update',{id:idea.id,fields:ideaInput({title:'Refined',description:'Changed',projects:idea.projects})});
  assert.equal(state.ideas[0].original,'A thought');assert.equal(state.ideas[0].history.length,1);
  await assert.rejects(save('idea.create',{fields:{title:'Bad',complexity:'easy'}}),/Invalid complexity/);
  await assert.rejects(save('idea.create',{fields:{title:'Bad',goalIds:['foreign']}}),/does not belong/);
});
test('graduation is atomic, requires success criteria, retains links and rejects stale or repeated requests',async t=>{
  const {store,save}=await setup(t);
  const idea=(await save('idea.create',{fields:{title:'Build this',projects:['Test'],tags:['useful']}})).ideas[0];
  const before=await store.read('LastResort');
  await assert.rejects(save('idea.graduate',{id:idea.id,targetVersion:idea.version,fields:{title:'Outcome'}}),/Define success/);
  assert.equal((await store.read('LastResort')).revision,before.revision);
  const state=await save('idea.graduate',{id:idea.id,targetVersion:idea.version,fields:{title:'Outcome',successCriteria:'A working result'}});
  assert.equal(state.ideas[0].status,'graduated');assert.deepEqual(state.goals[0].ideaIds,[idea.id]);
  assert.deepEqual(state.goals[0].projects,['Test']);assert.deepEqual(state.ideas[0].goalIds,[state.goals[0].id]);
  await assert.rejects(save('idea.graduate',{id:idea.id,targetVersion:idea.version,fields:{title:'Duplicate',successCriteria:'Oops'}}),/changed/);
  assert.equal((await store.read('LastResort')).goals.length,1);
  assert.equal((await store.read('Other')).ideas.length,0);
});
test('idea can join an existing goal and support a standalone experiment',async t=>{
  const {save}=await setup(t);
  const idea=(await save('idea.create',{fields:{title:'Experiment'}})).ideas[0];
  const task=(await save('task.create',{fields:{title:'Test',ideaIds:[idea.id]}})).tasks[0];
  assert.equal(task.goalId,'');assert.deepEqual(task.ideaIds,[idea.id]);
  const goal=(await save('goal.create',{fields:{title:'Existing'}})).goals[0];
  const state=await save('idea.graduate',{id:idea.id,targetVersion:idea.version,goalId:goal.id});
  assert.equal(state.goals.length,1);assert.deepEqual(state.goals[0].ideaIds,[idea.id]);
});
test('ordinary writes cannot bypass or reverse graduation, including Council edits',async t=>{
  const {save}=await setup(t);
  await assert.rejects(save('idea.create',{fields:{title:'Bypass',status:'graduated'}}),/Graduate to goal/);
  const idea=(await save('idea.create',{fields:{title:'Controlled'}})).ideas[0];
  await assert.rejects(save('idea.update',{id:idea.id,fields:{title:idea.title,status:'graduated'}}),/Graduate to goal/);
  let state=await save('idea.graduate',{id:idea.id,targetVersion:idea.version,fields:{title:'Goal',successCriteria:'Evidence'}});
  await assert.rejects(save('idea.update',{id:idea.id,fields:{title:'Undo',status:'inbox'}}),/retain their goal/);
  state=await save('recommendation.create',proposal('idea-review',state.ideas[0],{title:'Undo',status:'inbox'}));
  await assert.rejects(save('recommendation.resolve',{id:state.recommendations.at(-1).id,decision:'accepted'}),/retain their goal/);
});
test('Council idea changes require acceptance and exact target version; graduation creates a goal',async t=>{
  const {store,save}=await setup(t);
  let state=await save('recommendation.create',proposal('idea',null,{title:'Proposed idea'}));
  assert.equal(state.ideas.length,0);
  state=await save('recommendation.resolve',{id:state.recommendations[0].id,decision:'accepted'});
  const idea=state.ideas[0];
  state=await save('recommendation.create',proposal('idea-review',idea,{title:'Changed idea',value:'high'}));
  const stale=state.recommendations.at(-1);
  state=await save('idea.update',{id:idea.id,fields:{title:'Owner edit'}});
  await assert.rejects(save('recommendation.resolve',{id:stale.id,decision:'accepted'}),/Target changed/);
  state=await save('recommendation.create',proposal('idea-graduate',state.ideas[0],{title:'Committed',successCriteria:'Evidence'}));
  state=await save('recommendation.resolve',{id:state.recommendations.at(-1).id,decision:'accepted'});
  assert.equal(state.goals.length,1);assert.equal(state.ideas[0].status,'graduated');
  assert.equal(reviewPacket(await store.read('LastResort'),'council').ideas.length,1);
});
test('legacy opportunities keep identity, history and commercial evidence',async t=>{
  const {store,root}=await setup(t);await store.read('LastResort');
  const file=path.join(root,'LastResort/state/core.json');
  const state=await store.read('LastResort');
  delete state.ideas;state.opportunities=[{id:'old',version:3,title:'Legacy',owner:'Owner',status:'qualified',notes:'Original notes',valueCents:10000,contact:'Test',history:[]}];
  await writeFile(file,JSON.stringify(state));
  const migrated=await store.read('LastResort');
  assert.equal(migrated.ideas[0].id,'old');assert.equal(migrated.ideas[0].legacy.valueCents,10000);assert.equal(migrated.ideas[0].value,'unknown');
});
test('old workspace routes preserve scope and unknown workspaces do not redirect',()=>{
  assert.equal(canonicalWorkspacePath('/local/AubOS/tasks','/lastresort/bridge',['AubOS']),'/aubos/forge/tasks');
  assert.equal(canonicalWorkspacePath('/LastResort/opportunities','/lastresort/bridge',['LastResort']),'/lastresort/forge/ideas');
  assert.equal(canonicalWorkspacePath('/unknown/tasks','/lastresort/bridge',['LastResort']),'/unknown/tasks');
});
