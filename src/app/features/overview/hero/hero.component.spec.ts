import { TestBed } from '@angular/core/testing';
import { HeroComponent } from './hero.component';
import { activateTranslations, provideTranslateTesting } from '../../../testing/i18n.testing';

describe('HeroComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeroComponent],
      providers: [provideTranslateTesting()],
    }).compileComponents();

    activateTranslations();
  });

  it('creates the component', () => {
    const fixture = TestBed.createComponent(HeroComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the hero title', () => {
    const fixture = TestBed.createComponent(HeroComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.hero__title')?.textContent).toContain('Welcome to Your UI Plugin');
  });

  it('renders the constellation background', () => {
    const fixture = TestBed.createComponent(HeroComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.hero__constellation')).toBeTruthy();
    expect(compiled.querySelectorAll('.c-nodes circle').length).toBeGreaterThan(0);
  });
});
