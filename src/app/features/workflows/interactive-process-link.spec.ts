import { buildInteractiveProcessUrl } from './interactive-process-link';

describe('buildInteractiveProcessUrl', () => {
  const route = 'https://acme-corp.identitysoon.com/ui/plugin/starter';

  it('builds a Launchpad interactive process URL from the page route origin', () => {
    expect(buildInteractiveProcessUrl(route, 'process-123')).toBe(
      'https://acme-corp.identitysoon.com/ui/d/launchpad/interactive-processes/process-123'
    );
  });

  it('encodes the process ID in the URL', () => {
    expect(buildInteractiveProcessUrl(route, 'process/with/slashes')).toBe(
      'https://acme-corp.identitysoon.com/ui/d/launchpad/interactive-processes/process%2Fwith%2Fslashes'
    );
  });

  it('returns null when pageRoute is null', () => {
    expect(buildInteractiveProcessUrl(null, 'process-123')).toBeNull();
  });

  it('returns null when pageRoute is undefined', () => {
    expect(buildInteractiveProcessUrl(undefined, 'process-123')).toBeNull();
  });

  it('returns null when interactiveProcessId is empty', () => {
    expect(buildInteractiveProcessUrl(route, '')).toBeNull();
  });

  it('returns null when interactiveProcessId is null', () => {
    expect(buildInteractiveProcessUrl(route, null)).toBeNull();
  });

  it('returns null when pageRoute is not a valid URL', () => {
    expect(buildInteractiveProcessUrl('/ui/plugin/demo', 'process-123')).toBeNull();
  });
});
