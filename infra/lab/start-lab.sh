#!/bin/sh
# Runs in the student's container before the Jupyter server: on a fresh work volume, clone the course and
# give it a private .env from the example, so a new student starts with nothing to set up but their keys.
set -eu

if [ ! -d "${LC_MASTERY_ROOT}/.git" ]; then
  git clone --quiet "${COURSE_REPO}" "${LC_MASTERY_ROOT}"
fi

if [ ! -f "${LC_MASTERY_ROOT}/.env" ] && [ -f "${LC_MASTERY_ROOT}/.env.example" ]; then
  cp "${LC_MASTERY_ROOT}/.env.example" "${LC_MASTERY_ROOT}/.env"
  chmod 600 "${LC_MASTERY_ROOT}/.env"
fi

exec "$@"
