import { apiBaseUrl, DEFAULT_API_BASE_URL, venueId } from '../src/config';

test('apiBaseUrl falls back when env is unset', () => {
  const saved = process.env.API_BASE_URL;
  delete process.env.API_BASE_URL;
  try {
    expect(apiBaseUrl()).toBe(DEFAULT_API_BASE_URL);
  } finally {
    if (saved !== undefined) process.env.API_BASE_URL = saved;
  }
});

test('apiBaseUrl reads env and strips trailing slash', () => {
  const saved = process.env.API_BASE_URL;
  process.env.API_BASE_URL = 'http://192.168.1.10:3000/';
  try {
    expect(apiBaseUrl()).toBe('http://192.168.1.10:3000');
    expect(venueId()).toBe('demo');
  } finally {
    if (saved !== undefined) process.env.API_BASE_URL = saved;
    else delete process.env.API_BASE_URL;
  }
});
