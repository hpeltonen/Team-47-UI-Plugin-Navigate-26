import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { SailpointPluginService } from '@core';
import { IdentitiesService } from '@sailpoint/angular-sdk/identities';
import { TenantService } from '@sailpoint/angular-sdk/tenant';
import { ApiExamplesComponent } from './api-examples.component';
import { activateTranslations, provideTranslateTesting } from '../../testing/i18n.testing';

describe('ApiExamplesComponent', () => {
  let fixture: ComponentFixture<ApiExamplesComponent>;
  let component: ApiExamplesComponent;
  let compiled: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ApiExamplesComponent],
      providers: [
        provideTranslateTesting(),
        {
          provide: SailpointPluginService,
          useValue: { apiReady: signal(true) },
        },
        {
          provide: IdentitiesService,
          useValue: { listIdentitiesV1: () => of([]) },
        },
        {
          provide: TenantService,
          useValue: { getTenantV1: () => of({ id: 'tenant-1', name: 'Test Tenant' }) },
        },
      ],
    }).compileComponents();

    activateTranslations();
    fixture = TestBed.createComponent(ApiExamplesComponent);
    component = fixture.componentInstance;
    compiled = fixture.nativeElement;
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('renders the heading', () => {
    expect(compiled.querySelector('h2')?.textContent).toContain('API Examples');
  });

  it('renders both example sections', () => {
    const sections = compiled.querySelectorAll('.example-section');
    expect(sections.length).toBe(2);
    expect(sections[0].textContent).toContain('Observable Pattern');
    expect(sections[1].textContent).toContain('Promise Pattern');
  });

  it('renders Observable pattern button', () => {
    const buttons = compiled.querySelectorAll('p-button');
    expect(buttons[0].textContent).toContain('List Identities (Observable)');
  });

  it('renders Promise pattern button', () => {
    const buttons = compiled.querySelectorAll('p-button');
    expect(buttons[1].textContent).toContain('Get Tenant (Promise)');
  });

  it('exposes apiReady signal for button state', () => {
    expect(component['apiReady']()).toBe(true);
  });
});
