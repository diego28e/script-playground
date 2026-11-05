// The JupyterHub lab (infra/lab). Each student's server clones a course into a folder named after the course's
// slug (infra/lab/start-lab.sh), so a lesson's notebook lives at <course slug>/<lesson sourcePath>.
export const LAB_URL = "https://lab.academiadelcodigo.com";

/** Opens a notebook in the signed-in student's own lab; the hub starts the server first if it's stopped. */
export function labNotebookUrl(courseSlug: string, sourcePath: string) {
  return `${LAB_URL}/hub/user-redirect/lab/tree/${encodeURIComponent(courseSlug)}/${sourcePath.split("/").map(encodeURIComponent).join("/")}`;
}

/** The lesson's file in the course repository, at the commit the course was imported from. */
export function sourceFileUrl(repoUrl: string | null, ref: string | null, sourcePath: string | null) {
  if (!repoUrl || !ref || !sourcePath) return null;
  return `${repoUrl}/blob/${ref}/${sourcePath}`;
}

/** A lesson's page in the platform's lesson workspace. */
export function lessonPath(courseSlug: string, moduleSlug: string, lessonSlug: string) {
  return `/courses/${encodeURIComponent(courseSlug)}/${encodeURIComponent(moduleSlug)}/${encodeURIComponent(lessonSlug)}`;
}
