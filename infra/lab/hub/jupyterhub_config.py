# JupyterHub config for the lab. Every value that changes between "one student" and "open to students"
# comes from the environment (../.env), so opening the platform is a config change, not a rebuild.
import os
import sys

c = get_config()  # noqa: F821


def env_set(name):
    return {value.strip() for value in os.environ.get(name, "").split(",") if value.strip()}


# --- Who can sign in -------------------------------------------------------------------------------
# Google login. OAuthenticator reads OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET and OAUTH_CALLBACK_URL from the
# environment. The username is the Google account's email.
c.JupyterHub.authenticator_class = "google"

# Go straight to Google instead of showing the hub's "Sign in with Google" page.
c.Authenticator.auto_login = True

# Only the listed accounts can sign in. The server limit below counts running servers, not people, so
# without this list a second account could start a server while yours is stopped and take the slot.
c.Authenticator.allowed_users = env_set("LAB_ALLOWED_USERS")
c.Authenticator.admin_users = env_set("LAB_ADMIN_USERS")
if not c.Authenticator.allowed_users:
    sys.exit("LAB_ALLOWED_USERS must list at least one Google account email (see infra/lab/.env.example)")

# --- How many students at once -----------------------------------------------------------------------
# Running student servers across the hub; a start beyond it is refused until one stops.
c.JupyterHub.active_server_limit = int(os.environ.get("LAB_MAX_ACTIVE_SERVERS", "1"))
c.JupyterHub.concurrent_spawn_limit = c.JupyterHub.active_server_limit
c.JupyterHub.allow_named_servers = False

# --- One container per student -----------------------------------------------------------------------
c.JupyterHub.spawner_class = "docker"
c.DockerSpawner.image = os.environ["LAB_IMAGE"]
c.DockerSpawner.network_name = os.environ.get("LAB_NETWORK", "jupyterhub")
# A fresh container on every start (so a new image applies); the student's files are in the volume.
c.DockerSpawner.remove = True
c.DockerSpawner.notebook_dir = "/home/learner/work"
c.DockerSpawner.volumes = {"jupyterhub-user-{username}": "/home/learner/work"}
c.DockerSpawner.mem_limit = os.environ.get("LAB_MEM_LIMIT", "12G")
c.DockerSpawner.cpu_limit = float(os.environ.get("LAB_CPU_LIMIT", "3"))
c.DockerSpawner.extra_host_config = {
    "cap_drop": ["ALL"],
    "security_opt": ["no-new-privileges:true"],
    "pids_limit": int(os.environ.get("LAB_PIDS_LIMIT", "512")),
}
c.DockerSpawner.http_timeout = 120
c.DockerSpawner.start_timeout = 300
# Open JupyterLab with the file browser in the course folder.
c.Spawner.default_url = "/lab/tree/langchain-langgraph-mastery"

# --- The hub itself ----------------------------------------------------------------------------------
# Listens inside its container; compose publishes 8000 on 127.0.0.1 only and nginx terminates TLS.
c.JupyterHub.bind_url = "http://:8000"
c.JupyterHub.hub_ip = "0.0.0.0"
c.JupyterHub.hub_connect_ip = os.environ.get("LAB_HUB_HOST", "jupyterhub")
c.JupyterHub.db_url = "sqlite:////srv/jupyterhub/data/jupyterhub.sqlite"
c.JupyterHub.cookie_secret_file = "/srv/jupyterhub/data/jupyterhub_cookie_secret"

# Academia del Código branding: templates/ extends the hub's own pages (see templates/page.html).
c.JupyterHub.template_paths = ["/srv/jupyterhub/templates"]

# Stop a student's server after an hour without activity, which frees its slot.
c.JupyterHub.services = [
    {
        "name": "idle-culler",
        "command": [sys.executable, "-m", "jupyterhub_idle_culler", f"--timeout={os.environ.get('LAB_IDLE_TIMEOUT', '3600')}"],
    }
]
c.JupyterHub.load_roles = [
    {
        "name": "idle-culler",
        "scopes": ["list:users", "read:users:activity", "read:servers", "delete:servers"],
        "services": ["idle-culler"],
    }
]
