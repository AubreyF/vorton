import { createRoot } from "react-dom/client";
import { WorkspaceApp } from "./workspace";
import { ApplicationHeader } from "./design/application-header";
import { WorkspaceNavigation } from "./design/workspace-navigation";
import { BackgroundAtmosphere } from "./design/background-atmosphere";
import { initializeAppearance } from "./design/appearance-startup";
import { LastResortTools } from "./tools/last-resort-tools";
import { workspaceLinks, forgeViews } from "./forge";
import "./design/themes.css";
import "./design/workspace-shell.css";
import "./design/fonts.css";
import "./design/theme-preview.css";
import "./design/menu-selection.css";
import "./demo-shell.css";

const profile="LastResort";
const sections=workspaceLinks(profile);
function WorkspaceRoot() {
  const page=location.pathname.split("/")[2]||"bridge";
  const parts=location.pathname.split('/').filter(Boolean);
  const valid=/^\/lastresort(?:\/|$)/.test(location.pathname)&&sections.some(section=>section.id===page)&&(page === 'admin' || (page === 'forge' ? parts.length<=3 && (!parts[2] || forgeViews.includes(parts[2] as typeof forgeViews[number])) : parts.length<=2));
  document.title=`The Last Resort · ${sections.find(section=>section.id===page)?.label||"Not found"}`;
  return <><BackgroundAtmosphere/><div className="aubos-content-layer dashboard-shell single-level-navigation">
    <a className="skip-link" href="#workspace-main">Skip to content</a>
    <ApplicationHeader profile={profile} labels={{LastResort:"The Last Resort"}}><WorkspaceNavigation profile={profile} page={page} links={sections.map(section=>({...section,path:`/lastresort/${section.id}`}))}/></ApplicationHeader>
    <main className="view-frame" id="workspace-main" tabIndex={-1}>
      {valid?<WorkspaceApp profile={profile} page={page} forgeView={parts[2]??""} adminSection={location.pathname.split('/').slice(3).join('/')} renderTools={({draftTask})=><LastResortTools onDraftTask={draftTask}/>}/>:<section><h1>Page not found</h1><a href="/lastresort/bridge">Return to Bridge</a></section>}
    </main>
  </div></>;
}
initializeAppearance();
const root=document.getElementById("root");
if(root)createRoot(root).render(<WorkspaceRoot/>);
