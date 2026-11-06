# Jupyter Server config for a student's container. Read from /opt/jupyter/etc/jupyter/ on startup.
# JupyterHub handles login and tells jupyterhub-singleuser where to listen, so neither is set here.

import os

c = get_config()  # noqa: F821

# The platform's lesson page shows the lesson's notebook in a frame (docs/notebook-embed.md). The hub passes the
# sites allowed to frame this server ('self' and the platform); without it, only 'self'. jupyterhub-singleuser keeps
# a value set here (its own default is 'none').
c.ServerApp.tornado_settings = {
    "headers": {"Content-Security-Policy": f"frame-ancestors {os.environ.get('LAB_FRAME_ANCESTORS', chr(39) + 'self' + chr(39))}"},
}

c.ServerApp.root_dir = "/home/learner/work"

# The course's .env lives in the clone; show dotfiles so a student can open it and add their keys.
c.ContentsManager.allow_hidden = True

# Only the course kernel: no stray "Python 3" kernel from the server's own env.
c.KernelSpecManager.ensure_native_kernel = False
c.KernelSpecManager.allowed_kernelspecs = {"lc-mastery"}
c.MultiKernelManager.default_kernel_name = "lc-mastery"

# Shut down kernels idle for an hour so forgotten ones give their memory back (the hub's culler then
# stops the whole server).
c.MappingKernelManager.cull_idle_timeout = 3600
c.MappingKernelManager.cull_interval = 300

# Deleted files go to the trash in the container's home, which a new container wipes; delete for real instead.
c.FileContentsManager.delete_to_trash = False
