import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import S3erver from 's3rver'

const testEnv = {
  NODE_ENV: 'test',
  PORT: 3000,
  LOG_LEVEL: 'info',
  LOG_MODE: 'stdout',
  LOG_FILE: 'server.log',
  TURBO_TOKEN: ['changeme'],
  STORAGE_PROVIDER: 's3',
  STORAGE_PATH: 'turborepo-remote-cache-test',
  AWS_ACCESS_KEY_ID: 'S3RVER',
  AWS_SECRET_ACCESS_KEY: 'S3RVER',
  AWS_REGION: '',
  S3_ENDPOINT: 'http://localhost:4568',
}
Object.assign(process.env, testEnv)

const server = new S3erver({
  directory: tmpdir(),
  silent: true,
  configureBuckets: [
    {
      name: process.env.STORAGE_PATH,
    },
  ],
})

server.run((err) => {
  assert.equal(err, null)
  test('Amazon S3', async (t) => {
    const artifactId = crypto.randomBytes(20).toString('hex')
    const team = 'superteam'

    const { createApp } = await import('../src/app.js')
    const app = createApp({ logger: false })
    await app.ready()

    await t.test('loads correct env vars', async () => {
      assert.equal(app.config.STORAGE_PROVIDER, testEnv.STORAGE_PROVIDER)
      assert.equal(app.config.STORAGE_PATH, testEnv.STORAGE_PATH)
      assert.equal(app.config.AWS_ACCESS_KEY_ID, testEnv.AWS_ACCESS_KEY_ID)
      assert.equal(
        app.config.AWS_SECRET_ACCESS_KEY,
        testEnv.AWS_SECRET_ACCESS_KEY,
      )
      assert.equal(app.config.AWS_REGION, testEnv.AWS_REGION)
      assert.equal(app.config.S3_ENDPOINT, testEnv.S3_ENDPOINT)
    })

    await t.test(
      'should return 400 when missing authorization header',
      async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/v8/artifacts/not-found',
          headers: {},
        })
        assert.equal(response.statusCode, 400)
        assert.equal(response.json().message, 'Missing Authorization header')
      },
    )

    await t.test(
      'should return 401 when wrong authorization token is provided',
      async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/v8/artifacts/not-found',
          headers: {
            authorization: 'wrong token',
          },
        })
        assert.equal(response.statusCode, 401)
        assert.equal(response.json().message, 'Invalid authorization token')
      },
    )

    await t.test(
      'should return 400 when missing team query parameter',
      async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/v8/artifacts/not-found',
          headers: {
            authorization: 'Bearer changeme',
          },
        })
        assert.equal(response.statusCode, 400)
        assert.equal(
          response.json().message,
          "querystring should have required property 'team'",
        )
      },
    )

    await t.test('should return 404 on cache miss', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v8/artifacts/not-found',
        headers: {
          authorization: 'Bearer changeme',
        },
        query: {
          team: 'superteam',
        },
      })
      assert.equal(response.statusCode, 404)
      assert.equal(response.json().message, 'Artifact not found')
    })

    await t.test('should upload an artifact', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/v8/artifacts/${artifactId}`,
        headers: {
          authorization: 'Bearer changeme',
          'content-type': 'application/octet-stream',
        },
        query: {
          team,
        },
        payload: Buffer.from('test cache data'),
      })
      assert.equal(response.statusCode, 200)
      assert.deepEqual(response.json(), { urls: [`${team}/${artifactId}`] })
    })

    await t.test('should download an artifact', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/v8/artifacts/${artifactId}`,
        headers: {
          authorization: 'Bearer changeme',
        },
        query: {
          team,
        },
      })
      assert.equal(response.statusCode, 200)
      assert.deepEqual(response.body, 'test cache data')
    })

    await t.test('should verify artifact exists', async () => {
      const response = await app.inject({
        method: 'HEAD',
        url: `/v8/artifacts/${artifactId}`,
        headers: {
          authorization: 'Bearer changeme',
        },
        query: {
          team,
        },
      })
      assert.equal(response.statusCode, 200)
      assert.deepEqual(response.body, '')
    })

    await t.test('should verify artifact does not exist', async () => {
      const response = await app.inject({
        method: 'HEAD',
        url: '/v8/artifacts/not-found',
        headers: {
          authorization: 'Bearer changeme',
        },
        query: {
          team,
        },
      })
      assert.equal(response.statusCode, 404)
      assert.equal(response.json().message, 'Artifact not found')
    })

    t.after(() => {
      server.close()
    })
  })
})
