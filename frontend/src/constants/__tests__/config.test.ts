import { resolveApiBaseUrl } from '@/constants/config';

describe('resolveApiBaseUrl', () => {
  test('a literal setting is used as is', () => {
    expect(resolveApiBaseUrl('http://localhost:8000/api/v1', '192.168.1.5')).toBe(
      'http://localhost:8000/api/v1',
    );
    expect(resolveApiBaseUrl('/api/v1', 'example.com')).toBe('/api/v1');
  });

  test('{host} takes the host the page was loaded from', () => {
    expect(resolveApiBaseUrl('http://{host}:8000/api/v1', '192.168.31.240')).toBe(
      'http://192.168.31.240:8000/api/v1',
    );
    expect(resolveApiBaseUrl('http://{host}:8000/api/v1', 'localhost')).toBe(
      'http://localhost:8000/api/v1',
    );
  });

  test('{host} falls back to localhost without a page host (native, tests)', () => {
    expect(resolveApiBaseUrl('http://{host}:8000/api/v1', undefined)).toBe(
      'http://localhost:8000/api/v1',
    );
    expect(resolveApiBaseUrl('http://{host}:8000/api/v1', '')).toBe('http://localhost:8000/api/v1');
  });
});
