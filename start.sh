#!/bin/bash

pm2 delete kino
cd kino
pm2 start index.js --name kino --cron "0 6 * * *"
cd ..

pm2 delete goal
cd goal
pm2 start index.js --name goal --cron "0 6 * * *"
cd ..