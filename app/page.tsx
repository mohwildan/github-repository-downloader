'use client'

import path from 'path'
import { useState } from 'react'
import axios from 'axios'
import { saveAs } from 'file-saver'
import JSZip from 'jszip'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

const MAX_CONCURRENT_REQUESTS = 5
const CACHE_TIME = 5 * 60 * 1000 // 5 minutes
const API_VERSION = '2022-11-28'

export default function Home() {
  const [repoUrl, setRepoUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [downloadUrl, setDownloadUrl] = useState('')

  // Use the token from the .env file
  const githubToken = process.env.NEXT_PUBLIC_GITHUB_TOKEN || ''

  const parseRepoUrl = (url: string) => {
    let owner, repo
    if (url.startsWith('git@github.com:')) {
      // SSH URL
      ;[owner, repo] = url.split(':')[1].split('/')
    } else if (url.startsWith('https://github.com/')) {
      // HTTPS URL
      ;[owner, repo] = url.split('github.com/')[1].split('/')
    } else {
      throw new Error('Invalid GitHub URL format')
    }
    repo = repo.replace('.git', '')
    return { owner, repo }
  }

  const fetchWithCache = async (url: string, options: any) => {
    const cache = new Map()
    const cacheKey = url + JSON.stringify(options)
    if (cache.has(cacheKey)) {
      const { data, timestamp } = cache.get(cacheKey)
      if (Date.now() - timestamp < CACHE_TIME) {
        return data
      }
    }
    const response = await axios(url, options)
    cache.set(cacheKey, { data: response.data, timestamp: Date.now() })
    return response.data
  }

  const downloadRepo = async () => {
    setLoading(true)
    setError(null)
    setProgress(0)
    const zip = new JSZip()

    try {
      const { owner, repo } = parseRepoUrl(repoUrl)
      let apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents`

      const downloadContent = async (url: string, path = '') => {
        const content = await fetchWithCache(url, {
          headers: {
            Authorization: `token ${githubToken}`,
            Accept: 'application/vnd.github.v3+json',
            'X-GitHub-Api-Version': API_VERSION,
          },
        })

        const downloadPromises = []

        if (Array.isArray(content)) {
          for (const item of content) {
            if (item.type === 'file') {
              downloadPromises.push(
                fetchWithCache(item.url, {
                  headers: {
                    Authorization: `token ${githubToken}`,
                    Accept: 'application/vnd.github.v3.raw',
                  },
                  responseType: 'arraybuffer',
                }).then((data) => {
                  zip.file(path + item.name, data)
                  setProgress((prev) => Math.min(prev + 1, 100))
                })
              )
            } else if (item.type === 'dir') {
              downloadPromises.push(
                downloadContent(item.url, `${path}${item.name}/`)
              )
            }
          }
        }

        // Use Promise.all with chunking to limit concurrent requests
        while (downloadPromises.length > 0) {
          const chunk = downloadPromises.splice(0, MAX_CONCURRENT_REQUESTS)
          await Promise.all(chunk)
        }
      }

      await downloadContent(apiUrl)

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      saveAs(zipBlob, `${repo}.zip`)
    } catch (err: any) {
      if (err.response) {
        switch (err.response.status) {
          case 401:
            setError('Unauthorized: Please check your GitHub token.')
            break
          case 403:
            setError('Forbidden: You might have exceeded the API rate limit.')
            break
          case 404:
            setError(
              'Not Found: The repository or file does not exist or is not accessible.'
            )
            break
          default:
            setError(
              `Error downloading repository: ${err.response.status} ${err.response.statusText}`
            )
        }
      } else if (err.request) {
        setError('Network error: Unable to reach GitHub API.')
      } else {
        setError('An unexpected error occurred.')
      }
      console.error(err)
    }

    setLoading(false)
  }

  return (
    <div className='grid h-screen place-items-center'>
      <div className='container mx-auto p-4 max-w-4xl'>
        <h1 className='text-2xl font-bold mb-4'>
          GitHub Repository Downloader
        </h1>
        <input
          type='text'
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder='Enter GitHub repository URL (HTTPS or SSH)'
          className='w-full p-2 border rounded mb-4'
        />
        <Button onClick={downloadRepo} disabled={loading || !repoUrl}>
          {loading ? 'Downloading...' : 'Download Repository'}
        </Button>
        {loading && (
          <Progress value={progress} className='w-full mt-4' max={100} />
        )}
        {error && <p className='text-red-500 mt-4'>{error}</p>}
      </div>
    </div>
  )
}
