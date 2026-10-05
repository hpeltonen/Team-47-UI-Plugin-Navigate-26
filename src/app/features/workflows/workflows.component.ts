import { Component, inject, OnInit, signal } from '@angular/core';
import { SailpointPluginService } from '@core';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { LauncherService, type Launcher } from './launcher.service';
import { buildInteractiveProcessUrl } from './interactive-process-link';

@Component({
  selector: 'app-workflows',
  standalone: true,
  imports: [ButtonModule, TagModule, TranslatePipe],
  templateUrl: './workflows.component.html',
  styleUrl: './workflows.component.scss',
})
export class WorkflowsComponent implements OnInit {
  private readonly plugin = inject(SailpointPluginService);
  private readonly launcherService = inject(LauncherService);

  protected readonly apiReady = this.plugin.apiReady;
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly launchers = signal<Launcher[]>([]);

  protected readonly startingId = signal<string | null>(null);
  protected readonly startError = signal('');
  protected readonly interactiveProcessId = signal<string | null>(null);
  protected readonly interactiveProcessUrl = signal<string | null>(null);

  ngOnInit(): void {
    if (this.apiReady()) {
      this.loadLaunchers();
    }
  }

  async loadLaunchers(): Promise<void> {
    this.loading.set(true);
    this.error.set('');

    try {
      const result = await this.launcherService.listLaunchers();
      this.launchers.set(result);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loading.set(false);
    }
  }

  async startLauncher(launcher: Launcher): Promise<void> {
    this.startingId.set(launcher.id);
    this.startError.set('');
    this.interactiveProcessId.set(null);
    this.interactiveProcessUrl.set(null);

    try {
      const processId = await this.launcherService.startLauncher(launcher.id);
      this.interactiveProcessId.set(processId);

      const pageRoute = this.plugin.context()?.page.route ?? null;
      this.interactiveProcessUrl.set(buildInteractiveProcessUrl(pageRoute, processId));
    } catch (err) {
      this.startError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.startingId.set(null);
    }
  }
}
