#!/usr/bin/env node
'use strict';

const { runNightlyJob } = require('../src/cron');

runNightlyJob()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[nightly] Fatal:', err.message);
    process.exit(1);
  });
