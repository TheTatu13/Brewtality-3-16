import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GITHUB_TOKEN;

const REQUIRED_TOPICS = ['job-seeker-ro-spider', 'peviitor-ro'];
// In the template's own checkout, GitHub also carries this extra topic --
// this test used to run unconditionally and fail on every push to
// Brewtality-3-16 itself as a result (caught via a live CI check during the
// Faza 4 audit, not by local jest, which always skips for lack of
// GITHUB_REPOSITORY).
const TEMPLATE_ONLY_TOPIC = 'scraper-template';

function isTemplateCheckout() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const pkgPath = path.resolve(__dirname, '../../package.json');
  if (!fs.existsSync(pkgPath)) return false;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  return pkg.name === 'peviitor-scraper-template';
}

describe('Repository Topics', () => {
  it('must have EXACTLY the required topics', async () => {
    if (!REPO) {
      console.log('GITHUB_REPOSITORY not set — running locally, skipping API check');
      return;
    }

    const headers = { Accept: 'application/vnd.github.mercy-preview+json', 'User-Agent': 'jest-test' };
    if (TOKEN) headers.Authorization = `token ${TOKEN}`;

    const res = await fetch(`https://api.github.com/repos/${REPO}/topics`, { headers });
    expect(res.ok).toBe(true);

    const data = await res.json();
    const topics = (data.names || []).map(t => t.toLowerCase()).sort();

    console.log(`Topics: [${topics.join(', ')}]`);

    const expected = (isTemplateCheckout() ? [...REQUIRED_TOPICS, TEMPLATE_ONLY_TOPIC] : REQUIRED_TOPICS).sort();
    expect(topics).toEqual(expected);
  });
});
