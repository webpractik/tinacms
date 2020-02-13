/**

Copyright 2019 Forestry.io Inc

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

*/

import { writeFile } from './file-writer'

import { promises as fs } from 'fs'
import * as path from 'path'
import * as express from 'express'

import { createUploader } from './upload'
import { checkFilePathIsInRepo } from './utils'
import { Repo } from './repo'

// Don't return full error message to client incase confidential details leak
const GIT_ERROR_MESSAGE =
  'Git Operation failed: Check the logs for more details'

export interface GitRouterConfig {
  defaultCommitMessage: string
  defaultCommitName: string
  defaultCommitEmail: string
  pushOnCommit: boolean
}

const DEFAULT_OPTIONS: GitRouterConfig = {
  defaultCommitMessage: 'Edited with TinaCMS',
  defaultCommitName: 'TinaCMS',
  defaultCommitEmail: 'git@tinacms.org',
  pushOnCommit: true,
}

export function router(repo: Repo, config: Partial<GitRouterConfig> = {}) {
  const {
    defaultCommitMessage,
    defaultCommitName,
    defaultCommitEmail,
    pushOnCommit,
  }: GitRouterConfig = { ...DEFAULT_OPTIONS, ...config }

  const uploader = createUploader(repo.tmpDir)

  const router = express.Router()
  router.use(express.json())

  router.delete('/:relPath', async (req: any, res: any) => {
    try {
      const user = req.user || {}
      const fileRelativePath = decodeURIComponent(req.params.relPath)

      await repo.deleteFiles(fileRelativePath, {
        name: user.name || req.body.name || defaultCommitName,
        email: user.email || req.body.email || defaultCommitEmail,
        message: `Update from Tina: delete ${fileRelativePath}`,
        files: [fileRelativePath],
      })

      if (pushOnCommit) {
        await repo.push()
      }

      res.json({ status: 'success' })
    } catch {
      res.status(500).json({ status: 'error', message: GIT_ERROR_MESSAGE })
    }
  })

  router.put('/:relPath', (req: any, res: any) => {
    try {
      const fileRelativePath = decodeURIComponent(req.params.relPath)
      const fileAbsolutePath = repo.fileAbsolutePath(fileRelativePath)
      const fileIsInRepo = checkFilePathIsInRepo(
        fileAbsolutePath,
        repo.contentAbsolutePath
      )
      if (fileIsInRepo) {
        writeFile(fileAbsolutePath, req.body.content)
      } else {
        throw new Error(
          `Failed to write to: ${fileRelativePath} \nCannot write outside of the content directory.`
        )
      }
      res.json({ content: req.body.content })
    } catch {
      res.status(500).json({ status: 'error', message: GIT_ERROR_MESSAGE })
    }
  })

  router.post(
    '/upload',
    uploader.single('file'),
    async (req: any, res: any) => {
      try {
        const fileName = req.file.originalname
        const tmpPath = path.join(repo.tmpDir, fileName)
        const finalPath = path.join(
          repo.pathToRepo,
          req.body.directory,
          fileName
        )
        await fs.rename(tmpPath, finalPath)
        res.send(req.file)
      } catch {
        res.status(500).json({ status: 'error', message: GIT_ERROR_MESSAGE })
      }
    }
  )

  router.post('/commit', async (req: any, res: any) => {
    try {
      const user = req.user || {}
      const message = req.body.message || defaultCommitMessage

      // TODO: Separate commit and push???
      await repo.commit({
        name: user.name || req.body.name || defaultCommitName,
        email: user.email || req.body.email || defaultCommitEmail,
        message,
        files: req.body.files,
      })

      if (pushOnCommit) {
        await repo.push()
      }

      res.json({ status: 'success' })
    } catch {
      // TODO: More intelligently respond
      res.status(412).json({ status: 'failure', error: GIT_ERROR_MESSAGE })
    }
  })

  router.post('/push', async (req: any, res: any) => {
    try {
      await repo.push()
      res.json({ status: 'success' })
    } catch {
      // TODO: More intelligently respond
      res.status(412).json({ status: 'failure', error: GIT_ERROR_MESSAGE })
    }
  })

  router.post('/reset', async (req, res) => {
    try {
      // TODO: I feel like this in wrong. Taking a list of files and then only resetting the first one?
      await repo.reset(req.body.files[0])
      res.json({ status: 'success' })
    } catch {
      res.status(412).json({ status: 'failure', error: GIT_ERROR_MESSAGE })
    }
  })

  router.get('/show/:fileRelativePath', async (req, res) => {
    try {
      const content = await repo.getFileAtHead(req.params.fileRelativePath)

      res.json({
        fileRelativePath: req.params.fileRelativePath,
        content,
        status: 'success',
      })
    } catch {
      res.status(501)
      res.json({
        status: 'failure',
        message: GIT_ERROR_MESSAGE,
        fileRelativePath: req.params.fileRelativePath,
      })
    }
  })

  return router
}
