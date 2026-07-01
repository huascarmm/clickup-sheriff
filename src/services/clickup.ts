/**
 * Cliente de la API de ClickUp. Usa fetch nativo de Node 20.
 * El token llega por inyeccion (desde Secret Manager), no se lee de la BD.
 */
import type { ClickUpTask } from '../domain/types.js';

export class ClickUpService {
  constructor(private token: string) {}

  async getTask(taskId: string): Promise<ClickUpTask> {
    const url = `https://api.clickup.com/api/v2/task/${encodeURIComponent(taskId)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: this.token, Accept: 'application/json' }
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Error consultando tarea ClickUp. Status: ${res.status}. Body: ${text}`);
    }
    return JSON.parse(text) as ClickUpTask;
  }

  async setCheckboxField(taskId: string, fieldId: string, value: boolean): Promise<void> {
    const url = `https://api.clickup.com/api/v2/task/${encodeURIComponent(
      taskId
    )}/field/${encodeURIComponent(fieldId)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.token,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ value: Boolean(value) })
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Error seteando campo en ClickUp. Status: ${res.status}. Body: ${text}`);
    }
  }
}
