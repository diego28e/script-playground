# JupyterHub for the lab: Google login, one Docker container per student (DockerSpawner), idle servers stopped.
# Build: docker compose build (from infra/lab), or docker build -t lab-hub:6.1.1 infra/lab/hub
# The hub's major version must match jupyterhub-singleuser in the student image (../Dockerfile).

FROM quay.io/jupyterhub/jupyterhub:6.1.1

RUN python3 -m pip install --no-cache-dir \
      dockerspawner==14.0.0 \
      oauthenticator==17.4.0 \
      jupyterhub-idle-culler==2.0.0

COPY jupyterhub_config.py /srv/jupyterhub/jupyterhub_config.py
COPY templates /srv/jupyterhub/templates
# The platform logo, served by the hub as {{ static_url("images/academia-logo.png") }}.
COPY static/academia-logo.png /srv/venv/share/jupyterhub/static/images/academia-logo.png
# The database and cookie secret live here (a volume in compose.yaml).
RUN mkdir -p /srv/jupyterhub/data

WORKDIR /srv/jupyterhub
CMD ["jupyterhub", "-f", "/srv/jupyterhub/jupyterhub_config.py"]
