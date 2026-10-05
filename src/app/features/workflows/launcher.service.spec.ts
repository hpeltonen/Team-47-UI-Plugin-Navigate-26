import { TestBed } from '@angular/core/testing';
import { SailpointPluginService } from '@core';
import { LauncherService, type Launcher } from './launcher.service';

function makeLauncher(overrides: Partial<Launcher> = {}): Launcher {
  return {
    id: 'launcher-1',
    name: 'Demo Launcher',
    description: 'A launcher for testing.',
    type: 'INTERACTIVE_PROCESS',
    disabled: false,
    ...overrides,
  };
}

describe('LauncherService', () => {
  const mockGet = vi.fn();
  const mockPost = vi.fn();

  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();

    TestBed.configureTestingModule({
      providers: [
        {
          provide: SailpointPluginService,
          useValue: {
            get: mockGet,
            post: mockPost,
          },
        },
      ],
    });
  });

  describe('listLaunchers', () => {
    it('lists assigned launchers via plugin.get()', async () => {
      const items = [
        makeLauncher({ id: 'a', name: 'Alpha' }),
        makeLauncher({ id: 'b', name: 'Beta' }),
      ];
      mockGet.mockResolvedValue({ items });

      const launchers = await TestBed.inject(LauncherService).listLaunchers();

      expect(launchers.map((l) => l.id)).toEqual(['a', 'b']);
      expect(mockGet).toHaveBeenCalledWith(
        '/beta/launchers/my/assigned?limit=100&sorters=name'
      );
    });

    it('returns empty array when response has no items', async () => {
      mockGet.mockResolvedValue({});

      const launchers = await TestBed.inject(LauncherService).listLaunchers();

      expect(launchers).toEqual([]);
    });
  });

  describe('startLauncher', () => {
    it('starts a launcher via plugin.post()', async () => {
      mockPost.mockResolvedValue({ interactiveProcessId: 'process-123' });

      const processId = await TestBed.inject(LauncherService).startLauncher('launcher-1');

      expect(processId).toBe('process-123');
      expect(mockPost).toHaveBeenCalledWith(
        '/beta/launchers/launcher-1/launch',
        {}
      );
    });

    it('encodes launcher ID in the URL', async () => {
      mockPost.mockResolvedValue({ interactiveProcessId: 'process-456' });

      await TestBed.inject(LauncherService).startLauncher('launcher/with/slashes');

      expect(mockPost).toHaveBeenCalledWith(
        '/beta/launchers/launcher%2Fwith%2Fslashes/launch',
        {}
      );
    });

    it('throws when response has no interactiveProcessId', async () => {
      mockPost.mockResolvedValue({});

      await expect(
        TestBed.inject(LauncherService).startLauncher('launcher-1')
      ).rejects.toThrow('Launcher started without an interactive process id.');
    });
  });
});
