#!/bin/bash

pm2 delete kino
cd kino
pm2 start index.js --name kino --cron "0 6 * * *"
