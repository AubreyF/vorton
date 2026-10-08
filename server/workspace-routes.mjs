// Keep page aliases separate from command API endpoints and case-sensitive assets.
export function canonicalWorkspacePath(pathname, defaultPath, profiles) {
  const path = pathname === "/" ? defaultPath : pathname;
  const match = path.match(/^\/(?:local\/)?([^/]+)(\/.*)?$/i);
  if (!match || !profiles.some(profile => profile.toLowerCase() === match[1].toLowerCase())) return path;
  const workspace = match[1].toLowerCase();
  const suffix = (match[2] ?? "").toLowerCase();
  if (["", "/", "/command", "/command/", "/command-bridge", "/command-bridge/", "/bridge/"].includes(suffix)) return `/${workspace}/bridge`;
  const forge = {"/goals":"goals", "/tasks":"tasks", "/opportunities":"ideas", "/ideas":"ideas"};
  const clean = suffix.replace(/\/$/, "");
  if (forge[clean]) return `/${workspace}/forge/${forge[clean]}`;
  if (clean === "/guestbook") return `/${workspace}/admin/organization`;
  return `/${workspace}${suffix}`;
}
