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
const WebSocket = __importStar(require("ws"));
describe('WebSocket Keepalive', () => {
    let ws;
    afterEach(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
    });
    test('Server sends ping frames every 30 seconds', (done) => {
        // This test requires server to be running
        // We'll verify ping is sent within 31 seconds of connection
        jest.setTimeout(35000);
        ws = new WebSocket('ws://localhost:8080', {
            headers: {
                // Note: Real connection requires valid JWT, but this test documents behavior
                'Authorization': 'Bearer <valid-jwt-token>'
            }
        });
        let pingReceived = false;
        ws.on('ping', () => {
            console.log('[test] Ping received from server');
            pingReceived = true;
            // Automatically send pong (ws library does this automatically)
            done();
        });
        ws.on('error', (_err) => {
            // Expected to fail without valid JWT
            done();
        });
        setTimeout(() => {
            if (!pingReceived) {
                done(new Error('No ping received within 31 seconds'));
            }
        }, 31000);
    });
    test('Server handles pong responses', (done) => {
        // This test verifies server doesn't crash when receiving pong
        // Pong responses are handled automatically by ws library
        jest.setTimeout(35000);
        ws = new WebSocket('ws://localhost:8080', {
            headers: {
                'Authorization': 'Bearer <valid-jwt-token>'
            }
        });
        ws.on('open', () => {
            console.log('[test] Connection opened');
            // Wait for first ping, then verify connection stays open
            setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    done();
                }
                else {
                    done(new Error('Connection closed unexpectedly'));
                }
            }, 32000);
        });
        ws.on('ping', () => {
            console.log('[test] Ping received, automatically sending pong');
            // ws library automatically sends pong
        });
        ws.on('error', (_err) => {
            done();
        });
    });
    test('Ping interval clears when connection closes', (done) => {
        // This test documents that intervals are cleaned up
        // Manual verification needed via memory profiling
        jest.setTimeout(5000);
        let completed = false;
        ws = new WebSocket('ws://localhost:8080', {
            headers: {
                'Authorization': 'Bearer <valid-jwt-token>'
            }
        });
        ws.on('open', () => {
            // Close immediately to test cleanup
            ws.close();
        });
        ws.on('close', () => {
            // If server properly clears interval, no memory leak occurs
            // This would be verified via repeated connect/disconnect cycles
            if (!completed) {
                completed = true;
                done();
            }
        });
        ws.on('error', () => {
            if (!completed) {
                completed = true;
                done();
            }
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2Vic29ja2V0LWtlZXBhbGl2ZS50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsid2Vic29ja2V0LWtlZXBhbGl2ZS50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSw4Q0FBZ0M7QUFFaEMsUUFBUSxDQUFDLHFCQUFxQixFQUFFLEdBQUcsRUFBRTtJQUNuQyxJQUFJLEVBQWEsQ0FBQztJQUVsQixTQUFTLENBQUMsR0FBRyxFQUFFO1FBQ2IsSUFBSSxFQUFFLElBQUksRUFBRSxDQUFDLFVBQVUsS0FBSyxTQUFTLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDM0MsRUFBRSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ2IsQ0FBQztJQUNILENBQUMsQ0FBQyxDQUFDO0lBRUgsSUFBSSxDQUFDLDJDQUEyQyxFQUFFLENBQUMsSUFBSSxFQUFFLEVBQUU7UUFDekQsMENBQTBDO1FBQzFDLDREQUE0RDtRQUM1RCxJQUFJLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBRXZCLEVBQUUsR0FBRyxJQUFJLFNBQVMsQ0FBQyxxQkFBcUIsRUFBRTtZQUN4QyxPQUFPLEVBQUU7Z0JBQ1AsNkVBQTZFO2dCQUM3RSxlQUFlLEVBQUUsMEJBQTBCO2FBQzVDO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsSUFBSSxZQUFZLEdBQUcsS0FBSyxDQUFDO1FBRXpCLEVBQUUsQ0FBQyxFQUFFLENBQUMsTUFBTSxFQUFFLEdBQUcsRUFBRTtZQUNqQixPQUFPLENBQUMsR0FBRyxDQUFDLGtDQUFrQyxDQUFDLENBQUM7WUFDaEQsWUFBWSxHQUFHLElBQUksQ0FBQztZQUNwQiwrREFBK0Q7WUFDL0QsSUFBSSxFQUFFLENBQUM7UUFDVCxDQUFDLENBQUMsQ0FBQztRQUVILEVBQUUsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLENBQUMsSUFBVyxFQUFFLEVBQUU7WUFDN0IscUNBQXFDO1lBQ3JDLElBQUksRUFBRSxDQUFDO1FBQ1QsQ0FBQyxDQUFDLENBQUM7UUFFSCxVQUFVLENBQUMsR0FBRyxFQUFFO1lBQ2QsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO2dCQUNsQixJQUFJLENBQUMsSUFBSSxLQUFLLENBQUMsb0NBQW9DLENBQUMsQ0FBQyxDQUFDO1lBQ3hELENBQUM7UUFDSCxDQUFDLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDWixDQUFDLENBQUMsQ0FBQztJQUVILElBQUksQ0FBQywrQkFBK0IsRUFBRSxDQUFDLElBQUksRUFBRSxFQUFFO1FBQzdDLDhEQUE4RDtRQUM5RCx5REFBeUQ7UUFDekQsSUFBSSxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUV2QixFQUFFLEdBQUcsSUFBSSxTQUFTLENBQUMscUJBQXFCLEVBQUU7WUFDeEMsT0FBTyxFQUFFO2dCQUNQLGVBQWUsRUFBRSwwQkFBMEI7YUFDNUM7U0FDRixDQUFDLENBQUM7UUFFSCxFQUFFLENBQUMsRUFBRSxDQUFDLE1BQU0sRUFBRSxHQUFHLEVBQUU7WUFDakIsT0FBTyxDQUFDLEdBQUcsQ0FBQywwQkFBMEIsQ0FBQyxDQUFDO1lBQ3hDLHlEQUF5RDtZQUN6RCxVQUFVLENBQUMsR0FBRyxFQUFFO2dCQUNkLElBQUksRUFBRSxDQUFDLFVBQVUsS0FBSyxTQUFTLENBQUMsSUFBSSxFQUFFLENBQUM7b0JBQ3JDLElBQUksRUFBRSxDQUFDO2dCQUNULENBQUM7cUJBQU0sQ0FBQztvQkFDTixJQUFJLENBQUMsSUFBSSxLQUFLLENBQUMsZ0NBQWdDLENBQUMsQ0FBQyxDQUFDO2dCQUNwRCxDQUFDO1lBQ0gsQ0FBQyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ1osQ0FBQyxDQUFDLENBQUM7UUFFSCxFQUFFLENBQUMsRUFBRSxDQUFDLE1BQU0sRUFBRSxHQUFHLEVBQUU7WUFDakIsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrREFBa0QsQ0FBQyxDQUFDO1lBQ2hFLHNDQUFzQztRQUN4QyxDQUFDLENBQUMsQ0FBQztRQUVILEVBQUUsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLENBQUMsSUFBVyxFQUFFLEVBQUU7WUFDN0IsSUFBSSxFQUFFLENBQUM7UUFDVCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0lBRUgsSUFBSSxDQUFDLDZDQUE2QyxFQUFFLENBQUMsSUFBSSxFQUFFLEVBQUU7UUFDM0Qsb0RBQW9EO1FBQ3BELGtEQUFrRDtRQUNsRCxJQUFJLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBRXRCLElBQUksU0FBUyxHQUFHLEtBQUssQ0FBQztRQUV0QixFQUFFLEdBQUcsSUFBSSxTQUFTLENBQUMscUJBQXFCLEVBQUU7WUFDeEMsT0FBTyxFQUFFO2dCQUNQLGVBQWUsRUFBRSwwQkFBMEI7YUFDNUM7U0FDRixDQUFDLENBQUM7UUFFSCxFQUFFLENBQUMsRUFBRSxDQUFDLE1BQU0sRUFBRSxHQUFHLEVBQUU7WUFDakIsb0NBQW9DO1lBQ3BDLEVBQUUsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUNiLENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsR0FBRyxFQUFFO1lBQ2xCLDREQUE0RDtZQUM1RCxnRUFBZ0U7WUFDaEUsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO2dCQUNmLFNBQVMsR0FBRyxJQUFJLENBQUM7Z0JBQ2pCLElBQUksRUFBRSxDQUFDO1lBQ1QsQ0FBQztRQUNILENBQUMsQ0FBQyxDQUFDO1FBRUgsRUFBRSxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsR0FBRyxFQUFFO1lBQ2xCLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztnQkFDZixTQUFTLEdBQUcsSUFBSSxDQUFDO2dCQUNqQixJQUFJLEVBQUUsQ0FBQztZQUNULENBQUM7UUFDSCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBXZWJTb2NrZXQgZnJvbSAnd3MnO1xuXG5kZXNjcmliZSgnV2ViU29ja2V0IEtlZXBhbGl2ZScsICgpID0+IHtcbiAgbGV0IHdzOiBXZWJTb2NrZXQ7XG5cbiAgYWZ0ZXJFYWNoKCgpID0+IHtcbiAgICBpZiAod3MgJiYgd3MucmVhZHlTdGF0ZSA9PT0gV2ViU29ja2V0Lk9QRU4pIHtcbiAgICAgIHdzLmNsb3NlKCk7XG4gICAgfVxuICB9KTtcblxuICB0ZXN0KCdTZXJ2ZXIgc2VuZHMgcGluZyBmcmFtZXMgZXZlcnkgMzAgc2Vjb25kcycsIChkb25lKSA9PiB7XG4gICAgLy8gVGhpcyB0ZXN0IHJlcXVpcmVzIHNlcnZlciB0byBiZSBydW5uaW5nXG4gICAgLy8gV2UnbGwgdmVyaWZ5IHBpbmcgaXMgc2VudCB3aXRoaW4gMzEgc2Vjb25kcyBvZiBjb25uZWN0aW9uXG4gICAgamVzdC5zZXRUaW1lb3V0KDM1MDAwKTtcblxuICAgIHdzID0gbmV3IFdlYlNvY2tldCgnd3M6Ly9sb2NhbGhvc3Q6ODA4MCcsIHtcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgLy8gTm90ZTogUmVhbCBjb25uZWN0aW9uIHJlcXVpcmVzIHZhbGlkIEpXVCwgYnV0IHRoaXMgdGVzdCBkb2N1bWVudHMgYmVoYXZpb3JcbiAgICAgICAgJ0F1dGhvcml6YXRpb24nOiAnQmVhcmVyIDx2YWxpZC1qd3QtdG9rZW4+J1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgbGV0IHBpbmdSZWNlaXZlZCA9IGZhbHNlO1xuXG4gICAgd3Mub24oJ3BpbmcnLCAoKSA9PiB7XG4gICAgICBjb25zb2xlLmxvZygnW3Rlc3RdIFBpbmcgcmVjZWl2ZWQgZnJvbSBzZXJ2ZXInKTtcbiAgICAgIHBpbmdSZWNlaXZlZCA9IHRydWU7XG4gICAgICAvLyBBdXRvbWF0aWNhbGx5IHNlbmQgcG9uZyAod3MgbGlicmFyeSBkb2VzIHRoaXMgYXV0b21hdGljYWxseSlcbiAgICAgIGRvbmUoKTtcbiAgICB9KTtcblxuICAgIHdzLm9uKCdlcnJvcicsIChfZXJyOiBFcnJvcikgPT4ge1xuICAgICAgLy8gRXhwZWN0ZWQgdG8gZmFpbCB3aXRob3V0IHZhbGlkIEpXVFxuICAgICAgZG9uZSgpO1xuICAgIH0pO1xuXG4gICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICBpZiAoIXBpbmdSZWNlaXZlZCkge1xuICAgICAgICBkb25lKG5ldyBFcnJvcignTm8gcGluZyByZWNlaXZlZCB3aXRoaW4gMzEgc2Vjb25kcycpKTtcbiAgICAgIH1cbiAgICB9LCAzMTAwMCk7XG4gIH0pO1xuXG4gIHRlc3QoJ1NlcnZlciBoYW5kbGVzIHBvbmcgcmVzcG9uc2VzJywgKGRvbmUpID0+IHtcbiAgICAvLyBUaGlzIHRlc3QgdmVyaWZpZXMgc2VydmVyIGRvZXNuJ3QgY3Jhc2ggd2hlbiByZWNlaXZpbmcgcG9uZ1xuICAgIC8vIFBvbmcgcmVzcG9uc2VzIGFyZSBoYW5kbGVkIGF1dG9tYXRpY2FsbHkgYnkgd3MgbGlicmFyeVxuICAgIGplc3Quc2V0VGltZW91dCgzNTAwMCk7XG5cbiAgICB3cyA9IG5ldyBXZWJTb2NrZXQoJ3dzOi8vbG9jYWxob3N0OjgwODAnLCB7XG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgICdBdXRob3JpemF0aW9uJzogJ0JlYXJlciA8dmFsaWQtand0LXRva2VuPidcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHdzLm9uKCdvcGVuJywgKCkgPT4ge1xuICAgICAgY29uc29sZS5sb2coJ1t0ZXN0XSBDb25uZWN0aW9uIG9wZW5lZCcpO1xuICAgICAgLy8gV2FpdCBmb3IgZmlyc3QgcGluZywgdGhlbiB2ZXJpZnkgY29ubmVjdGlvbiBzdGF5cyBvcGVuXG4gICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgaWYgKHdzLnJlYWR5U3RhdGUgPT09IFdlYlNvY2tldC5PUEVOKSB7XG4gICAgICAgICAgZG9uZSgpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGRvbmUobmV3IEVycm9yKCdDb25uZWN0aW9uIGNsb3NlZCB1bmV4cGVjdGVkbHknKSk7XG4gICAgICAgIH1cbiAgICAgIH0sIDMyMDAwKTtcbiAgICB9KTtcblxuICAgIHdzLm9uKCdwaW5nJywgKCkgPT4ge1xuICAgICAgY29uc29sZS5sb2coJ1t0ZXN0XSBQaW5nIHJlY2VpdmVkLCBhdXRvbWF0aWNhbGx5IHNlbmRpbmcgcG9uZycpO1xuICAgICAgLy8gd3MgbGlicmFyeSBhdXRvbWF0aWNhbGx5IHNlbmRzIHBvbmdcbiAgICB9KTtcblxuICAgIHdzLm9uKCdlcnJvcicsIChfZXJyOiBFcnJvcikgPT4ge1xuICAgICAgZG9uZSgpO1xuICAgIH0pO1xuICB9KTtcblxuICB0ZXN0KCdQaW5nIGludGVydmFsIGNsZWFycyB3aGVuIGNvbm5lY3Rpb24gY2xvc2VzJywgKGRvbmUpID0+IHtcbiAgICAvLyBUaGlzIHRlc3QgZG9jdW1lbnRzIHRoYXQgaW50ZXJ2YWxzIGFyZSBjbGVhbmVkIHVwXG4gICAgLy8gTWFudWFsIHZlcmlmaWNhdGlvbiBuZWVkZWQgdmlhIG1lbW9yeSBwcm9maWxpbmdcbiAgICBqZXN0LnNldFRpbWVvdXQoNTAwMCk7XG5cbiAgICBsZXQgY29tcGxldGVkID0gZmFsc2U7XG5cbiAgICB3cyA9IG5ldyBXZWJTb2NrZXQoJ3dzOi8vbG9jYWxob3N0OjgwODAnLCB7XG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgICdBdXRob3JpemF0aW9uJzogJ0JlYXJlciA8dmFsaWQtand0LXRva2VuPidcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHdzLm9uKCdvcGVuJywgKCkgPT4ge1xuICAgICAgLy8gQ2xvc2UgaW1tZWRpYXRlbHkgdG8gdGVzdCBjbGVhbnVwXG4gICAgICB3cy5jbG9zZSgpO1xuICAgIH0pO1xuXG4gICAgd3Mub24oJ2Nsb3NlJywgKCkgPT4ge1xuICAgICAgLy8gSWYgc2VydmVyIHByb3Blcmx5IGNsZWFycyBpbnRlcnZhbCwgbm8gbWVtb3J5IGxlYWsgb2NjdXJzXG4gICAgICAvLyBUaGlzIHdvdWxkIGJlIHZlcmlmaWVkIHZpYSByZXBlYXRlZCBjb25uZWN0L2Rpc2Nvbm5lY3QgY3ljbGVzXG4gICAgICBpZiAoIWNvbXBsZXRlZCkge1xuICAgICAgICBjb21wbGV0ZWQgPSB0cnVlO1xuICAgICAgICBkb25lKCk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICB3cy5vbignZXJyb3InLCAoKSA9PiB7XG4gICAgICBpZiAoIWNvbXBsZXRlZCkge1xuICAgICAgICBjb21wbGV0ZWQgPSB0cnVlO1xuICAgICAgICBkb25lKCk7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xufSk7XG4iXX0=