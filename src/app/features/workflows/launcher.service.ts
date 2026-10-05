import { inject, Injectable } from '@angular/core';
import { SailpointPluginService } from '@core';

/**
 * Launcher returned by the `/beta/launchers/my/assigned` endpoint.
 *
 * The Angular SDK's `LaunchersService.getLaunchersV1()` returns all tenant
 * launchers (admin scope). For user-scoped launchers — the ones assigned to the
 * signed-in user via Launchpad — use `plugin.get()` against the `my/assigned`
 * endpoint shown here.
 */
export interface Launcher {
  id: string;
  name: string;
  description?: string;
  type: string;
  disabled: boolean;
}

interface AssignedLaunchersResponse {
  items?: Launcher[];
}

interface LaunchResponse {
  interactiveProcessId?: string;
}

@Injectable({ providedIn: 'root' })
export class LauncherService {
  private readonly plugin = inject(SailpointPluginService);

  /**
   * Launchers assigned to the signed-in user, in the order Launchpad uses.
   *
   * Uses `plugin.get()` against the user-scoped `/beta/launchers/my/assigned`
   * endpoint. The Angular SDK's `LaunchersService.getLaunchersV1()` returns all
   * tenant launchers and requires admin scope; filter client-side if that is
   * acceptable for your use case.
   */
  async listLaunchers(): Promise<Launcher[]> {
    const response = await this.plugin.get<AssignedLaunchersResponse>(
      '/beta/launchers/my/assigned?limit=100&sorters=name'
    );
    return response.items ?? [];
  }

  /**
   * Start a Launcher and return the Interactive Process it created.
   *
   * The workflow runs server-side; the returned ID is the handle the user needs
   * to complete any interactive steps in the Launchpad.
   */
  async startLauncher(launcherId: string): Promise<string> {
    const response = await this.plugin.post<LaunchResponse>(
      `/beta/launchers/${encodeURIComponent(launcherId)}/launch`,
      {}
    );
    if (!response.interactiveProcessId) {
      throw new Error('Launcher started without an interactive process id.');
    }
    return response.interactiveProcessId;
  }
}
