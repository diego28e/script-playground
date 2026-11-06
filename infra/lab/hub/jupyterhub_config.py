# JupyterHub config for the lab. Every value that changes between "one student" and "open to students"
# comes from the environment (../.env), so opening the platform is a config change, not a rebuild.
import os
import sys

c = get_config()  # noqa: F821


def env_set(name):
    return {value.strip() for value in os.environ.get(name, "").split(",") if value.strip()}


# --- Who can sign in -------------------------------------------------------------------------------
# Students sign in with their Academia del Código account: the platform is the OpenID Connect provider
# (lib/auth.ts in the platform) and this hub is its trusted client, created once at /admin/lab-access.
# OAuthenticator reads OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET and OAUTH_CALLBACK_URL from the environment.
platform = os.environ["LAB_PLATFORM_URL"].rstrip("/")
# Where the hub itself reaches the platform for tokens and user info. The same address in production; on a
# development machine the hub's container reaches the host's platform at host.docker.internal instead.
platform_api = os.environ.get("LAB_PLATFORM_INTERNAL_URL", platform).rstrip("/")

c.JupyterHub.authenticator_class = "generic-oauth"
c.GenericOAuthenticator.login_service = "Academia del Código"
c.GenericOAuthenticator.authorize_url = f"{platform}/api/auth/oauth2/authorize"
c.GenericOAuthenticator.token_url = f"{platform_api}/api/auth/oauth2/token"
c.GenericOAuthenticator.userdata_url = f"{platform_api}/api/auth/oauth2/userinfo"
c.GenericOAuthenticator.scope = ["openid", "profile", "email"]
# The client is registered for client_secret_basic, and the platform refuses any other method.
c.GenericOAuthenticator.basic_auth = True
c.GenericOAuthenticator.enable_pkce = True
# The username is the account's email, as it was with Google, so every student keeps their volume
# (jupyterhub-user-{username}) and their work.
c.GenericOAuthenticator.username_claim = "email"

# Who gets in is the platform's `groups` claim (lib/lab-access.ts in the platform): "lab" for anyone enrolled
# in a published course, "lab-admin" for platform admins. Enrolling in a course is what grants the lab.
c.GenericOAuthenticator.manage_groups = True
c.GenericOAuthenticator.auth_state_groups_key = "oauth_user.groups"
c.GenericOAuthenticator.allowed_groups = {"lab"}
c.GenericOAuthenticator.admin_groups = {"lab-admin"}
# Optional extra accounts by email, admitted even without the "lab" group (the platform still signs them in:
# every login goes through it, so these lists don't help while it's down). Normally leave both empty.
c.Authenticator.allowed_users = env_set("LAB_ALLOWED_USERS")
c.Authenticator.admin_users = env_set("LAB_ADMIN_USERS")

# Go straight to the platform's sign-in instead of showing the hub's own login button. A student already
# signed in on the platform comes back without seeing a login page at all.
c.Authenticator.auto_login = True
# Groups are read at sign-in, so a hub login lasts a day: a student who leaves every course loses the lab
# within a day, and one who enrolls gets it at their next sign-in (usually without noticing one).
c.JupyterHub.cookie_max_age_days = 1

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

# --- Inside the platform's lesson page (docs/notebook-embed.md) -----------------------------------------
# The hub and each student's server send `frame-ancestors 'none'` by default (JupyterHub 4.1 and later), so no site
# may show them in a frame; both keep a value set here. The platform may: its lesson page embeds the lesson's notebook. Nothing else may. The student's server gets
# the same list through its environment (jupyter_server_config.py reads it).
frame_ancestors = " ".join(["'self'", platform, *sorted(env_set("LAB_EXTRA_FRAME_ANCESTORS"))])
c.JupyterHub.tornado_settings = {"headers": {"Content-Security-Policy": f"frame-ancestors {frame_ancestors}"}}
c.Spawner.environment = {"LAB_FRAME_ANCESTORS": frame_ancestors}

# Academia del Código branding: templates/ extends the hub's own pages (see templates/page.html).
c.JupyterHub.template_paths = ["/srv/jupyterhub/templates"]
# The platform's address, for links in the pages (e.g. "Ver los cursos" on the no-access page).
c.JupyterHub.template_vars = {"platform_url": platform}

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
