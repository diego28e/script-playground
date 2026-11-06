// The JupyterHub lab (infra/lab). Each student's server clones a course into a folder named after the course's
// slug (infra/lab/start-lab.sh), so a lesson's notebook lives at <course slug>/<lesson sourcePath>.
// NEXT_PUBLIC_LAB_URL points it elsewhere for development (a JupyterLab on this machine).
export const LAB_URL = (process.env.NEXT_PUBLIC_LAB_URL || "https://lab.academiadelcodigo.com").replace(/\/$/, "");

const notebookPath = (courseSlug: string, sourcePath: string) =>
  `${encodeURIComponent(courseSlug)}/${sourcePath.split("/").map(encodeURIComponent).join("/")}`;

/** Opens a notebook in the signed-in student's own lab; the hub starts the server first if it's stopped. */
export function labNotebookUrl(courseSlug: string, sourcePath: string) {
  return `${LAB_URL}/hub/user-redirect/lab/tree/${notebookPath(courseSlug, sourcePath)}`;
}

/**
 * The same notebook in JupyterLab's single-document view (just the notebook, no file browser), for the lesson page's
 * Notebook tab (docs/notebook-embed.md).
 */
export function labEmbedUrl(courseSlug: string, sourcePath: string) {
  return `${LAB_URL}/hub/user-redirect/doc/tree/${notebookPath(courseSlug, sourcePath)}`;
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
