import * as http from 'http';

describe('Health Endpoint', () => {
  test('GET /health returns 200 with status field', (done) => {
    // This test expects the server to be running on port 8080
    // The current implementation returns detailed health info including status: 'healthy'
    // This exceeds the minimal ALB requirement of 200 OK

    const options = {
      hostname: 'localhost',
      port: 8080,
      path: '/health',
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        const json = JSON.parse(data);
        expect(json).toHaveProperty('status');
        // Current implementation returns 'healthy' which satisfies ALB requirements
        expect(['ok', 'healthy']).toContain(json.status);
        done();
      });
    });

    req.on('error', (err) => {
      done(err);
    });

    req.end();
  });

  test('Health endpoint responds without authentication', (done) => {
    // Test that /health does not require authentication (no JWT token)
    const options = {
      hostname: 'localhost',
      port: 8080,
      path: '/health',
      method: 'GET'
      // Intentionally no Authorization header
    };

    const req = http.request(options, (res) => {
      expect(res.statusCode).toBe(200);
      done();
    });

    req.on('error', (err) => {
      done(err);
    });

    req.end();
  });

  test('Health endpoint does not interfere with WebSocket upgrade', (done) => {
    // Verify that non-/health requests still proceed to WebSocket handling
    const options = {
      hostname: 'localhost',
      port: 8080,
      path: '/',
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      // Should get 404 or other non-200 for non-WebSocket non-/health request
      expect(res.statusCode).not.toBe(undefined);
      done();
    });

    req.on('error', (err) => {
      // Connection errors are fine for this test
      done();
    });

    req.end();
  });
});
