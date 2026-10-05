import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SailpointPluginService } from '@core';
import { WorkflowsComponent } from './workflows.component';
import { LauncherService, type Launcher } from './launcher.service';
import { activateTranslations, provideTranslateTesting } from '../../testing/i18n.testing';

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

describe('WorkflowsComponent', () => {
  let fixture: ComponentFixture<WorkflowsComponent>;
  let component: WorkflowsComponent;
  let compiled: HTMLElement;

  const mockListLaunchers = vi.fn();
  const mockStartLauncher = vi.fn();
  const mockContext = signal({
    page: { route: 'https://acme.identitysoon.com/ui/plugin/starter' },
    tenant: { org: 'acme' },
    user: { displayName: 'Test User', email: 'test@example.com' },
  });

  beforeEach(async () => {
    mockListLaunchers.mockReset().mockResolvedValue([]);
    mockStartLauncher.mockReset();

    await TestBed.configureTestingModule({
      imports: [WorkflowsComponent],
      providers: [
        provideTranslateTesting(),
        {
          provide: SailpointPluginService,
          useValue: { context: mockContext, apiReady: signal(true) },
        },
        {
          provide: LauncherService,
          useValue: {
            listLaunchers: mockListLaunchers,
            startLauncher: mockStartLauncher,
          },
        },
      ],
    }).compileComponents();

    activateTranslations();
    fixture = TestBed.createComponent(WorkflowsComponent);
    component = fixture.componentInstance;
    compiled = fixture.nativeElement;
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('renders the heading', () => {
    expect(compiled.querySelector('h2')?.textContent).toContain('Workflow Launchers');
  });

  it('loads launchers when loadLaunchers is called', async () => {
    const launchers = [makeLauncher({ id: 'a', name: 'Alpha' })];
    mockListLaunchers.mockResolvedValue(launchers);

    await component.loadLaunchers();
    fixture.detectChanges();

    expect(mockListLaunchers).toHaveBeenCalled();
    expect(compiled.textContent).toContain('Alpha');
  });

  it('displays error when loading fails', async () => {
    // Configure mock to reject, then manually trigger reload
    mockListLaunchers.mockRejectedValue(new Error('Network error'));

    await component.loadLaunchers();
    fixture.detectChanges();

    expect(compiled.querySelector('.error')?.textContent).toContain('Network error');
  });

  it('displays empty state when no launchers found', async () => {
    mockListLaunchers.mockResolvedValue([]);

    await component.loadLaunchers();
    fixture.detectChanges();

    expect(compiled.querySelector('.empty-state')?.textContent).toContain('No launchers found');
  });

  it('starts a launcher and shows the result', async () => {
    const launchers = [makeLauncher({ id: 'launcher-1', name: 'Demo' })];
    mockListLaunchers.mockResolvedValue(launchers);
    mockStartLauncher.mockResolvedValue('process-123');

    // Load launchers
    await component.loadLaunchers();
    fixture.detectChanges();

    // Start launcher
    await component.startLauncher(launchers[0]);
    fixture.detectChanges();

    expect(mockStartLauncher).toHaveBeenCalledWith('launcher-1');
    expect(compiled.querySelector('.launch-result code')?.textContent).toContain('process-123');
    expect(compiled.querySelector('.launch-result a')?.getAttribute('href')).toBe(
      'https://acme.identitysoon.com/ui/d/launchpad/interactive-processes/process-123'
    );
  });

  it('displays error when starting launcher fails', async () => {
    const launchers = [makeLauncher({ id: 'launcher-1', name: 'Demo' })];
    mockListLaunchers.mockResolvedValue(launchers);
    mockStartLauncher.mockRejectedValue(new Error('Launch failed'));

    await component.loadLaunchers();
    fixture.detectChanges();

    await component.startLauncher(launchers[0]);
    fixture.detectChanges();

    expect(compiled.querySelectorAll('.error')[0]?.textContent).toContain('Launch failed');
  });
});
