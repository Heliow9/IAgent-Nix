import { ipcMain } from 'electron'
import { z } from 'zod'

import { projectTemplateInputSchema } from '../../shared/contracts'
import { ProjectTemplateService } from '../projects/project-template-service'

const createProjectSchema = z.object({
  input: projectTemplateInputSchema,
  confirmationToken: z.string().length(64)
})

export function registerProjectIpc(service = new ProjectTemplateService()): void {
  ipcMain.handle('projects:preview', (_event, payload) => service.preview(projectTemplateInputSchema.parse(payload)))
  ipcMain.handle('projects:create', (_event, payload) => {
    const request = createProjectSchema.parse(payload)
    return service.create(request.input, request.confirmationToken)
  })
}
