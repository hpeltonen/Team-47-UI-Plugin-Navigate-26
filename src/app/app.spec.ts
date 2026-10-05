import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { SailpointPluginService } from '@core';
import { activateTranslations, provideTranslateTesting } from './testing/i18n.testing';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideTranslateTesting(),
        // Stub the plugin service so the component does not build a real SDK or
        // attempt an App Shell handshake during the test. The component only
        // reads the `context` and `status` signals.
        {
          provide: SailpointPluginService,
          useValue: {
            context: signal({
              tenant: { org: 'acme' },
              user: { displayName: 'Test User', email: 'test@acme.com' },
              page: { route: 'https://acme.identitysoon.com/ui/plugin/starter', subPath: '' },
            }),
            status: signal('ready'),
            user: signal({ id: 'u1', displayName: 'Test User', email: 'test@acme.com' }),
            apiReady: () => false,
            setRoute: () => Promise.resolve(),
          },
        },
      ],
    }).compileComponents();

    activateTranslations();
  });

  it('creates the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the arena title and the tenant and user context', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.page__title')?.textContent).toContain('Access Arena');
    const meta = compiled.querySelector('.page__meta');
    expect(meta?.textContent).toContain('acme');
    expect(meta?.textContent).toContain('Test User');
  });

  it('starts in the pick phase with the manager picker', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.picker')).toBeTruthy();
    expect(compiled.querySelector('app-arena')).toBeNull();
  });
});
