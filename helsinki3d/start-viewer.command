#!/bin/bash
cd "$(dirname "$0")" || exit 1
(sleep 2; open 'http://localhost:8000/viewer-cdn.html') &
python3 -m http.server 8000
