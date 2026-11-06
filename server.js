/**
 * @file server.js
 * @description Standalone production/local runner script for Liyanage Distributors API.
 * Re-exports the Express server instance and configures static file serving for public assets.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import app from './src/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Maps HTTP requests starting with /images directly to the public/images folder
app.use('/images', express.static(path.join(__dirname, 'public/images')));
app.use(express.static(path.join(__dirname, 'public')));

export default app;

