#!/usr/bin/env python3
"""Publish the bundled GH0ST build to its existing Netlify project.

Python 3 standard library only. No token is bundled or written to disk.
Usage: python3 Publish-GH0ST.py
       python3 Publish-GH0ST.py --check   # Validate bundle; no network or writes.
"""
import base64
import getpass
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile

SITE_ID = "1460fb0c-b81d-4624-aac5-b78658310ce0"
SITE_NAME = "gh0st-observatory"
API = "https://api.netlify.com/api/v1"
ARCHIVE_SHA256 = "92b5347aa58d007532610aefa022429d60c71b252626072aa709b0c260fbb29e"
ARCHIVE_BASE64 = """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"""

class PublishError(Exception):
    pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    # Authentication must never follow redirects to an unexpected destination.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

API_OPENER = urllib.request.build_opener(NoRedirect)

def bundle():
    data = base64.b64decode(ARCHIVE_BASE64)
    if hashlib.sha256(data).hexdigest() != ARCHIVE_SHA256:
        raise PublishError("The bundled archive failed its integrity check.")
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        if set(z.namelist()) != {"index.html", "_headers"} or z.testzip():
            raise PublishError("Unexpected or damaged deployment archive.")
        html = z.read("index.html")
        if b"GH0ST" not in html:
            raise PublishError("The archive does not contain the expected website.")
        if re.search(rb"nfp_[A-Za-z0-9_-]{16,}", html):
            raise PublishError("A credential-like string was found in the website.")
    return data, html

def api(token, path, payload=None):
    headers = {"Authorization": "Bearer " + token, "Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/zip"
    request = urllib.request.Request(API + path, data=payload, headers=headers,
                                     method="POST" if payload is not None else "GET")
    try:
        with API_OPENER.open(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        explanations = {
            401: "Netlify rejected the token. Use a valid personal access token.",
            403: "This token does not have permission for the GH0ST project.",
            404: "The GH0ST project or deploy is not accessible to this token.",
            429: "Netlify rate-limited the request. Retry later.",
        }
        raise PublishError(explanations.get(error.code, "Netlify API returned HTTP %s." % error.code)) from None
    except (urllib.error.URLError, TimeoutError) as error:
        raise PublishError("Cannot reach Netlify from this computer. Check its Internet connection. "
                           "A POST timeout may still have created a deploy; check the project before retrying.") from None
    except (ValueError, OSError):
        raise PublishError("Netlify returned an unreadable response; check the project's Deploys page.") from None

def main():
    data, html = bundle()
    if "--check" in sys.argv:
        print("Bundle verified: index.html and _headers; %s bytes. No network requests made." % len(data))
        return
    if any(arg not in ("--check",) for arg in sys.argv[1:]):
        raise PublishError("Unknown option. Use no arguments, or --check.")
    print("GH0ST production publisher")
    print("Target: gh0st-observatory.netlify.app")
    print("Uploads only the bundled frontend. Does not alter contracts or GitHub.")
    token = os.environ.get("NETLIFY_AUTH_TOKEN", "").strip()
    if not token:
        if not sys.stdin.isatty():
            raise PublishError("Run this file in Terminal to enter your token privately.")
        token = getpass.getpass("Netlify personal access token (hidden): ").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{10,}", token):
        raise PublishError("The token is empty or contains unexpected characters.")
    print("Checking project access...")
    site = api(token, "/sites/" + SITE_ID)
    if site.get("id") != SITE_ID or site.get("name") != SITE_NAME:
        raise PublishError("Project identity mismatch. Nothing was uploaded.")
    settings = site.get("build_settings") or {}
    if settings.get("repo_url") or settings.get("repo_path") or site.get("repo_url"):
        print("This project is connected to Git. A future production push may replace this manual deploy.")
        print("Lock publishing in Netlify afterward if this version must remain unchanged.")
        if input("Continue publishing this build? [y/N]: ").strip().lower() != "y":
            print("Cancelled. Nothing was uploaded.")
            return
    print("Uploading the existing build...")
    deploy = api(token, "/sites/" + SITE_ID + "/deploys?title=GH0ST-observatory-first-build", data)
    deploy_id = deploy.get("id")
    if not isinstance(deploy_id, str) or not re.fullmatch(r"[A-Za-z0-9-]+", deploy_id):
        raise PublishError("Upload response lacks a valid deploy ID. Check the project's Deploys page before retrying.")
    print("Deploy created: " + deploy_id)
    previous = None
    deadline = time.monotonic() + 300
    while True:
        state = deploy.get("state", "unknown")
        if state != previous:
            print("Deploy status: " + state)
            previous = state
        if state == "ready":
            break
        if state in ("error", "failed", "canceled", "cancelled", "rejected"):
            raise PublishError("Deployment did not succeed (" + state + "). Check Netlify's deploy details.")
        if time.monotonic() >= deadline:
            raise PublishError("Deploy is still processing. No success claimed; inspect deploy " + deploy_id + ".")
        time.sleep(3)
        deploy = api(token, "/deploys/" + deploy_id)
    # The public verification carries NO authorization header.
    url = "https://gh0st-observatory.netlify.app/"
    expected = hashlib.sha256(html).hexdigest()
    print("Verifying the public website against the bundled HTML...")
    for attempt in range(20):
        request = urllib.request.Request(url + "?gh0st_verify=" + deploy_id,
                                         headers={"Cache-Control": "no-cache"})
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                final_url = response.geturl()
                actual = response.read()
                if (response.status == 200
                    and final_url.startswith(url)
                    and hashlib.sha256(actual).hexdigest() == expected):
                    print("PUBLISHED AND VERIFIED: " + url)
                    return
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
        time.sleep(3)
    raise PublishError("Netlify reports the deploy ready, but the public HTML could not be verified. "
                       "Check publishing locks, visitor access controls, or HTML post-processing. "
                       "No public-site success claimed.")

if __name__ == "__main__":
    try:
        main()
    except (PublishError, KeyboardInterrupt, EOFError) as error:
        print("STOPPED: " + (str(error) or "Cancelled."), file=sys.stderr)
        sys.exit(1)
