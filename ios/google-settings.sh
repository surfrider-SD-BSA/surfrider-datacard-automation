# shellcheck shell=sh
#
# The directive above is load-bearing: this file is sourced, never executed, so
# there is no shebang to infer a target shell from and SC2148 stops the check
# before it reads a line. `sh` rather than `bash` because testflight.sh runs
# under /bin/sh, which is what has to source this safely.
#
# Mind the wording of any comment added here. A line beginning with the word
# that names the linter, followed by a space, is parsed as another directive and
# fails to parse as one -- which is how this file broke CI once already.
#
# This chapter's Google project, for the Drive picker in the iOS app.
#
# Committed on purpose, which is a reversal of how this started out. Both values
# ship inside every build anyway -- an iOS OAuth client has no client secret, so
# the client ID is already readable out of any .ipa, and the API key is fenced by
# the HTTP-referrer allowlist on the picker page's origin. Keeping them out of
# the repository bought no secrecy; it only meant a fresh clone built an app with
# no Drive button and said nothing about it.
#
# What it does cost: rotating these now means a new Google client AND a new build
# in front of every volunteer, where before it was free. That was the trade made
# knowingly.
#
# A FORK SHOULD NOT USE THESE. Point GooglePickerURL at your own copy of the
# picker page and put your own project's values in ios/.env.local, which is
# gitignored, sourced after this file, and therefore wins. An exported variable
# beats both. Setup is in docs/google-drive-ios.md.
export GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-859166248323-3hdk3g9bhaacn8k8rubukgkn09vm13a6.apps.googleusercontent.com}"
export GOOGLE_API_KEY="${GOOGLE_API_KEY:-AIzaSyC6Sm8t2Z_KXU6iYitN3qszTh_h38hQJdo}"
