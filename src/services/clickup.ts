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

  /** Setea un custom field arbitrario por id (usado por la verificacion en vivo). */
  async setCustomField(taskId: string, fieldId: string, value: unknown): Promise<void> {
    const url = `https://api.clickup.com/api/v2/task/${encodeURIComponent(
      taskId
    )}/field/${encodeURIComponent(fieldId)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: this.token, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Error seteando custom field. Status: ${res.status}. Body: ${text}`);
    }
  }

  /** Crea una tarea en una lista (para pruebas realistas en vivo). */
  async createTask(
    listId: string,
    input: { name: string; due_date?: number; assignees?: number[]; status?: string }
  ): Promise<ClickUpTask> {
    const url = `https://api.clickup.com/api/v2/list/${encodeURIComponent(listId)}/task`;
    const body: Record<string, unknown> = { name: input.name };
    if (input.due_date) body.due_date = input.due_date;
    if (input.assignees) body.assignees = input.assignees;
    if (input.status) body.status = input.status;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: this.token, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Error creando tarea. Status: ${res.status}. Body: ${text}`);
    return JSON.parse(text) as ClickUpTask;
  }

  /** Borra una tarea (limpieza tras la verificacion en vivo). */
  async deleteTask(taskId: string): Promise<void> {
    const url = `https://api.clickup.com/api/v2/task/${encodeURIComponent(taskId)}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: this.token, Accept: 'application/json' }
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Error borrando tarea. Status: ${res.status}. Body: ${text}`);
    }
  }
}
