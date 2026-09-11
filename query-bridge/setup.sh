#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/shadow-forge-query
sudo mkdir -p "$APP_DIR"
sudo cp server.js package.json .env "$APP_DIR/"
sudo cp shadow-forge-query.service /etc/systemd/system/shadow-forge-query.service
sudo chown -R root:root "$APP_DIR"
sudo chmod 600 "$APP_DIR/.env"
sudo systemctl daemon-reload
sudo systemctl enable --now shadow-forge-query
sudo systemctl --no-pager --full status shadow-forge-query
