"""Upload the filled workbook to SharePoint via Microsoft Graph.

Two auth modes:
  device_code        -- interactive, for a person running it by hand
  client_credentials -- unattended, for the scheduler

Upload is `PUT /me/drive/items/{item-id}/content` (or the drives/{drive-id}
equivalent for a site library). Files over 4 MB go through an upload session.
"""
from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Optional

import requests

log = logging.getLogger(__name__)

GRAPH = "https://graph.microsoft.com/v1.0"
AUTHORITY = "https://login.microsoftonline.com"
SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024


class GraphError(RuntimeError):
    pass


class SharePointClient:
    def __init__(self, tenant_id: Optional[str] = None, client_id: Optional[str] = None,
                 client_secret: Optional[str] = None, *, timeout: int = 120):
        self.tenant_id = tenant_id or os.environ.get("MS_TENANT_ID", "")
        self.client_id = client_id or os.environ.get("MS_CLIENT_ID", "")
        self.client_secret = client_secret or os.environ.get("MS_CLIENT_SECRET", "")
        self.timeout = timeout
        self._token: Optional[str] = None

    # -- auth ----------------------------------------------------------------
    def token_client_credentials(self) -> str:
        if not (self.tenant_id and self.client_id and self.client_secret):
            raise GraphError("MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET are required.")
        r = requests.post(
            f"{AUTHORITY}/{self.tenant_id}/oauth2/v2.0/token",
            data={"client_id": self.client_id, "client_secret": self.client_secret,
                  "scope": "https://graph.microsoft.com/.default",
                  "grant_type": "client_credentials"},
            timeout=self.timeout)
        r.raise_for_status()
        self._token = r.json()["access_token"]
        return self._token

    def token_device_code(self, scopes: str = "Files.ReadWrite.All offline_access") -> str:
        if not (self.tenant_id and self.client_id):
            raise GraphError("MS_TENANT_ID and MS_CLIENT_ID are required.")
        r = requests.post(f"{AUTHORITY}/{self.tenant_id}/oauth2/v2.0/devicecode",
                          data={"client_id": self.client_id, "scope": scopes},
                          timeout=self.timeout)
        r.raise_for_status()
        flow = r.json()
        print(flow["message"], flush=True)      # user-facing: code + URL

        deadline = time.time() + int(flow.get("expires_in", 900))
        interval = int(flow.get("interval", 5))
        while time.time() < deadline:
            time.sleep(interval)
            t = requests.post(
                f"{AUTHORITY}/{self.tenant_id}/oauth2/v2.0/token",
                data={"grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                      "client_id": self.client_id, "device_code": flow["device_code"]},
                timeout=self.timeout)
            body = t.json()
            if t.status_code == 200:
                self._token = body["access_token"]
                return self._token
            err = body.get("error")
            if err == "authorization_pending":
                continue
            if err == "slow_down":
                interval += 5
                continue
            raise GraphError(f"device code auth failed: {body}")
        raise GraphError("device code auth timed out")

    @property
    def headers(self) -> dict:
        if not self._token:
            raise GraphError("not authenticated: call token_device_code or "
                             "token_client_credentials first")
        return {"Authorization": f"Bearer {self._token}"}

    # -- upload --------------------------------------------------------------
    def upload(self, path: str | Path, item_id: str, drive_id: Optional[str] = None) -> dict:
        """Replace the content of an existing workbook, keeping its item id,
        share links and version history."""
        p = Path(path)
        size = p.stat().st_size
        base = (f"{GRAPH}/drives/{drive_id}/items/{item_id}" if drive_id
                else f"{GRAPH}/me/drive/items/{item_id}")

        if size <= SIMPLE_UPLOAD_LIMIT:
            r = requests.put(
                f"{base}/content", headers={
                    **self.headers,
                    "Content-Type": "application/vnd.openxmlformats-officedocument."
                                    "spreadsheetml.sheet"},
                data=p.read_bytes(), timeout=self.timeout)
            r.raise_for_status()
            return r.json()
        return self._upload_session(p, base, size)

    def _upload_session(self, p: Path, base: str, size: int) -> dict:
        r = requests.post(f"{base}/createUploadSession",
                          headers=self.headers,
                          json={"item": {"@microsoft.graph.conflictBehavior": "replace"}},
                          timeout=self.timeout)
        r.raise_for_status()
        url = r.json()["uploadUrl"]

        chunk = 5 * 1024 * 1024
        with p.open("rb") as fh:
            start = 0
            while start < size:
                data = fh.read(chunk)
                end = start + len(data) - 1
                resp = requests.put(url, data=data, timeout=self.timeout, headers={
                    "Content-Length": str(len(data)),
                    "Content-Range": f"bytes {start}-{end}/{size}"})
                if resp.status_code not in (200, 201, 202):
                    raise GraphError(f"chunk {start}-{end} failed: {resp.text[:300]}")
                start = end + 1
        return resp.json() if resp.content else {"status": "uploaded"}

    def find_item(self, filename: str, drive_id: Optional[str] = None) -> Optional[dict]:
        """Look up the workbook by name so the item id need not be hard-coded."""
        base = f"{GRAPH}/drives/{drive_id}/root" if drive_id else f"{GRAPH}/me/drive/root"
        r = requests.get(f"{base}/search(q='{filename}')",
                         headers=self.headers, timeout=self.timeout)
        r.raise_for_status()
        for item in r.json().get("value", []):
            if item.get("name") == filename:
                return item
        return None
