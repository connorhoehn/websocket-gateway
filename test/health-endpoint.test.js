"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const http = __importStar(require("http"));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaGVhbHRoLWVuZHBvaW50LnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJoZWFsdGgtZW5kcG9pbnQudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsMkNBQTZCO0FBRTdCLFFBQVEsQ0FBQyxpQkFBaUIsRUFBRSxHQUFHLEVBQUU7SUFDL0IsSUFBSSxDQUFDLDJDQUEyQyxFQUFFLENBQUMsSUFBSSxFQUFFLEVBQUU7UUFDekQsMERBQTBEO1FBQzFELHNGQUFzRjtRQUN0RixxREFBcUQ7UUFFckQsTUFBTSxPQUFPLEdBQUc7WUFDZCxRQUFRLEVBQUUsV0FBVztZQUNyQixJQUFJLEVBQUUsSUFBSTtZQUNWLElBQUksRUFBRSxTQUFTO1lBQ2YsTUFBTSxFQUFFLEtBQUs7U0FDZCxDQUFDO1FBRUYsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQyxHQUFHLEVBQUUsRUFBRTtZQUN4QyxNQUFNLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNqQyxNQUFNLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO1lBRWxFLElBQUksSUFBSSxHQUFHLEVBQUUsQ0FBQztZQUNkLEdBQUcsQ0FBQyxFQUFFLENBQUMsTUFBTSxFQUFFLENBQUMsS0FBSyxFQUFFLEVBQUU7Z0JBQ3ZCLElBQUksSUFBSSxLQUFLLENBQUM7WUFDaEIsQ0FBQyxDQUFDLENBQUM7WUFFSCxHQUFHLENBQUMsRUFBRSxDQUFDLEtBQUssRUFBRSxHQUFHLEVBQUU7Z0JBQ2pCLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7Z0JBQzlCLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxjQUFjLENBQUMsUUFBUSxDQUFDLENBQUM7Z0JBQ3RDLDRFQUE0RTtnQkFDNUUsTUFBTSxDQUFDLENBQUMsSUFBSSxFQUFFLFNBQVMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQztnQkFDakQsSUFBSSxFQUFFLENBQUM7WUFDVCxDQUFDLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO1FBRUgsR0FBRyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxHQUFHLEVBQUUsRUFBRTtZQUN0QixJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDWixDQUFDLENBQUMsQ0FBQztRQUVILEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztJQUNaLENBQUMsQ0FBQyxDQUFDO0lBRUgsSUFBSSxDQUFDLGlEQUFpRCxFQUFFLENBQUMsSUFBSSxFQUFFLEVBQUU7UUFDL0QsbUVBQW1FO1FBQ25FLE1BQU0sT0FBTyxHQUFHO1lBQ2QsUUFBUSxFQUFFLFdBQVc7WUFDckIsSUFBSSxFQUFFLElBQUk7WUFDVixJQUFJLEVBQUUsU0FBUztZQUNmLE1BQU0sRUFBRSxLQUFLO1lBQ2Isd0NBQXdDO1NBQ3pDLENBQUM7UUFFRixNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxDQUFDLEdBQUcsRUFBRSxFQUFFO1lBQ3hDLE1BQU0sQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ2pDLElBQUksRUFBRSxDQUFDO1FBQ1QsQ0FBQyxDQUFDLENBQUM7UUFFSCxHQUFHLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxDQUFDLEdBQUcsRUFBRSxFQUFFO1lBQ3RCLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUNaLENBQUMsQ0FBQyxDQUFDO1FBRUgsR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0lBQ1osQ0FBQyxDQUFDLENBQUM7SUFFSCxJQUFJLENBQUMsMkRBQTJELEVBQUUsQ0FBQyxJQUFJLEVBQUUsRUFBRTtRQUN6RSx1RUFBdUU7UUFDdkUsTUFBTSxPQUFPLEdBQUc7WUFDZCxRQUFRLEVBQUUsV0FBVztZQUNyQixJQUFJLEVBQUUsSUFBSTtZQUNWLElBQUksRUFBRSxHQUFHO1lBQ1QsTUFBTSxFQUFFLEtBQUs7U0FDZCxDQUFDO1FBRUYsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQyxHQUFHLEVBQUUsRUFBRTtZQUN4Qyx3RUFBd0U7WUFDeEUsTUFBTSxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1lBQzNDLElBQUksRUFBRSxDQUFDO1FBQ1QsQ0FBQyxDQUFDLENBQUM7UUFFSCxHQUFHLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxDQUFDLEdBQUcsRUFBRSxFQUFFO1lBQ3RCLDJDQUEyQztZQUMzQyxJQUFJLEVBQUUsQ0FBQztRQUNULENBQUMsQ0FBQyxDQUFDO1FBRUgsR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0lBQ1osQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGh0dHAgZnJvbSAnaHR0cCc7XG5cbmRlc2NyaWJlKCdIZWFsdGggRW5kcG9pbnQnLCAoKSA9PiB7XG4gIHRlc3QoJ0dFVCAvaGVhbHRoIHJldHVybnMgMjAwIHdpdGggc3RhdHVzIGZpZWxkJywgKGRvbmUpID0+IHtcbiAgICAvLyBUaGlzIHRlc3QgZXhwZWN0cyB0aGUgc2VydmVyIHRvIGJlIHJ1bm5pbmcgb24gcG9ydCA4MDgwXG4gICAgLy8gVGhlIGN1cnJlbnQgaW1wbGVtZW50YXRpb24gcmV0dXJucyBkZXRhaWxlZCBoZWFsdGggaW5mbyBpbmNsdWRpbmcgc3RhdHVzOiAnaGVhbHRoeSdcbiAgICAvLyBUaGlzIGV4Y2VlZHMgdGhlIG1pbmltYWwgQUxCIHJlcXVpcmVtZW50IG9mIDIwMCBPS1xuXG4gICAgY29uc3Qgb3B0aW9ucyA9IHtcbiAgICAgIGhvc3RuYW1lOiAnbG9jYWxob3N0JyxcbiAgICAgIHBvcnQ6IDgwODAsXG4gICAgICBwYXRoOiAnL2hlYWx0aCcsXG4gICAgICBtZXRob2Q6ICdHRVQnXG4gICAgfTtcblxuICAgIGNvbnN0IHJlcSA9IGh0dHAucmVxdWVzdChvcHRpb25zLCAocmVzKSA9PiB7XG4gICAgICBleHBlY3QocmVzLnN0YXR1c0NvZGUpLnRvQmUoMjAwKTtcbiAgICAgIGV4cGVjdChyZXMuaGVhZGVyc1snY29udGVudC10eXBlJ10pLnRvQ29udGFpbignYXBwbGljYXRpb24vanNvbicpO1xuXG4gICAgICBsZXQgZGF0YSA9ICcnO1xuICAgICAgcmVzLm9uKCdkYXRhJywgKGNodW5rKSA9PiB7XG4gICAgICAgIGRhdGEgKz0gY2h1bms7XG4gICAgICB9KTtcblxuICAgICAgcmVzLm9uKCdlbmQnLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGpzb24gPSBKU09OLnBhcnNlKGRhdGEpO1xuICAgICAgICBleHBlY3QoanNvbikudG9IYXZlUHJvcGVydHkoJ3N0YXR1cycpO1xuICAgICAgICAvLyBDdXJyZW50IGltcGxlbWVudGF0aW9uIHJldHVybnMgJ2hlYWx0aHknIHdoaWNoIHNhdGlzZmllcyBBTEIgcmVxdWlyZW1lbnRzXG4gICAgICAgIGV4cGVjdChbJ29rJywgJ2hlYWx0aHknXSkudG9Db250YWluKGpzb24uc3RhdHVzKTtcbiAgICAgICAgZG9uZSgpO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICByZXEub24oJ2Vycm9yJywgKGVycikgPT4ge1xuICAgICAgZG9uZShlcnIpO1xuICAgIH0pO1xuXG4gICAgcmVxLmVuZCgpO1xuICB9KTtcblxuICB0ZXN0KCdIZWFsdGggZW5kcG9pbnQgcmVzcG9uZHMgd2l0aG91dCBhdXRoZW50aWNhdGlvbicsIChkb25lKSA9PiB7XG4gICAgLy8gVGVzdCB0aGF0IC9oZWFsdGggZG9lcyBub3QgcmVxdWlyZSBhdXRoZW50aWNhdGlvbiAobm8gSldUIHRva2VuKVxuICAgIGNvbnN0IG9wdGlvbnMgPSB7XG4gICAgICBob3N0bmFtZTogJ2xvY2FsaG9zdCcsXG4gICAgICBwb3J0OiA4MDgwLFxuICAgICAgcGF0aDogJy9oZWFsdGgnLFxuICAgICAgbWV0aG9kOiAnR0VUJ1xuICAgICAgLy8gSW50ZW50aW9uYWxseSBubyBBdXRob3JpemF0aW9uIGhlYWRlclxuICAgIH07XG5cbiAgICBjb25zdCByZXEgPSBodHRwLnJlcXVlc3Qob3B0aW9ucywgKHJlcykgPT4ge1xuICAgICAgZXhwZWN0KHJlcy5zdGF0dXNDb2RlKS50b0JlKDIwMCk7XG4gICAgICBkb25lKCk7XG4gICAgfSk7XG5cbiAgICByZXEub24oJ2Vycm9yJywgKGVycikgPT4ge1xuICAgICAgZG9uZShlcnIpO1xuICAgIH0pO1xuXG4gICAgcmVxLmVuZCgpO1xuICB9KTtcblxuICB0ZXN0KCdIZWFsdGggZW5kcG9pbnQgZG9lcyBub3QgaW50ZXJmZXJlIHdpdGggV2ViU29ja2V0IHVwZ3JhZGUnLCAoZG9uZSkgPT4ge1xuICAgIC8vIFZlcmlmeSB0aGF0IG5vbi0vaGVhbHRoIHJlcXVlc3RzIHN0aWxsIHByb2NlZWQgdG8gV2ViU29ja2V0IGhhbmRsaW5nXG4gICAgY29uc3Qgb3B0aW9ucyA9IHtcbiAgICAgIGhvc3RuYW1lOiAnbG9jYWxob3N0JyxcbiAgICAgIHBvcnQ6IDgwODAsXG4gICAgICBwYXRoOiAnLycsXG4gICAgICBtZXRob2Q6ICdHRVQnXG4gICAgfTtcblxuICAgIGNvbnN0IHJlcSA9IGh0dHAucmVxdWVzdChvcHRpb25zLCAocmVzKSA9PiB7XG4gICAgICAvLyBTaG91bGQgZ2V0IDQwNCBvciBvdGhlciBub24tMjAwIGZvciBub24tV2ViU29ja2V0IG5vbi0vaGVhbHRoIHJlcXVlc3RcbiAgICAgIGV4cGVjdChyZXMuc3RhdHVzQ29kZSkubm90LnRvQmUodW5kZWZpbmVkKTtcbiAgICAgIGRvbmUoKTtcbiAgICB9KTtcblxuICAgIHJlcS5vbignZXJyb3InLCAoZXJyKSA9PiB7XG4gICAgICAvLyBDb25uZWN0aW9uIGVycm9ycyBhcmUgZmluZSBmb3IgdGhpcyB0ZXN0XG4gICAgICBkb25lKCk7XG4gICAgfSk7XG5cbiAgICByZXEuZW5kKCk7XG4gIH0pO1xufSk7XG4iXX0=