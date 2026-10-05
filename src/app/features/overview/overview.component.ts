import { Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { HeroComponent } from './hero/hero.component';

@Component({
  selector: 'app-overview',
  standalone: true,
  imports: [HeroComponent, TranslatePipe],
  templateUrl: './overview.component.html',
})
export class OverviewComponent {}
