import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const raw = fs.readFileSync(path.join(here, 'scraper.json'), 'utf-8');

const scraperConfig = JSON.parse(raw);

// Single source of truth for the outbound User-Agent — imported by the generic
// modules (anaf.js, api.js, job-validator.js) instead of a duplicated literal.
export const userAgent = scraperConfig.userAgent;

export default scraperConfig;
