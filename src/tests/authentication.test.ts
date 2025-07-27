/**
 * Authentication Unit Tests
 *
 * Tests the authentication middleware for the AI API route
 */

import { TestLogger } from './utils';

// Mock the authenticate function from the route
function authenticate(request: {
  headers: { get: (name: string) => string | null };
}): boolean {
  const API_PASSWORD = 'test-password';
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return false;

  // Support both Bearer token and basic auth formats
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7) === API_PASSWORD;
  }

  if (authHeader.startsWith('Basic ')) {
    const credentials = Buffer.from(
      authHeader.substring(6),
      'base64'
    ).toString();
    const [, password] = credentials.split(':');
    return password === API_PASSWORD;
  }

  return false;
}

interface TestResult {
  success: boolean;
  message: string;
  details?: any;
  duration?: number;
}

interface MockRequest {
  headers: { get: (name: string) => string | null };
}

class AuthenticationTests {
  async runAllTests(): Promise<boolean> {
    TestLogger.info('🔐 Starting Authentication Unit Tests');

    const tests = [
      () => this.testValidBearerToken(),
      () => this.testInvalidBearerToken(),
      () => this.testValidBasicAuth(),
      () => this.testInvalidBasicAuth(),
      () => this.testMissingAuthHeader(),
      () => this.testEmptyAuthHeader(),
      () => this.testMalformedBearerToken(),
      () => this.testMalformedBasicAuth(),
      () => this.testUnsupportedAuthScheme(),
      () => this.testCaseSensitivity(),
    ];

    const results: TestResult[] = [];

    for (const test of tests) {
      try {
        const result = await test();
        results.push(result);

        if (result.success) {
          TestLogger.success(`✅ ${test.name}: ${result.message}`);
        } else {
          TestLogger.error(`❌ ${test.name}: ${result.message}`);
        }
      } catch (error) {
        const errorResult: TestResult = {
          success: false,
          message: `Test failed: ${error instanceof Error ? error.message : String(error)}`,
        };
        results.push(errorResult);
        TestLogger.error(`❌ ${test.name}: ${errorResult.message}`);
      }
    }

    const passed = results.filter(r => r.success).length;
    const total = results.length;

    TestLogger.info(
      `📊 Authentication Tests Summary: ${passed}/${total} passed`
    );
    return passed === total;
  }

  private createMockRequest(authHeader: string | null): MockRequest {
    return {
      headers: {
        get: (name: string) => {
          if (name.toLowerCase() === 'authorization') {
            return authHeader;
          }
          return null;
        },
      },
    };
  }

  async testValidBearerToken(): Promise<TestResult> {
    const startTime = Date.now();

    const mockRequest = this.createMockRequest('Bearer test-password');
    const result = authenticate(mockRequest);

    return {
      success: result === true,
      message: result
        ? 'Valid Bearer token accepted'
        : 'Valid Bearer token rejected',
      details: { authHeader: 'Bearer test-password', result },
      duration: Date.now() - startTime,
    };
  }

  async testInvalidBearerToken(): Promise<TestResult> {
    const startTime = Date.now();

    const mockRequest = this.createMockRequest('Bearer wrong-password');
    const result = authenticate(mockRequest);

    return {
      success: result === false,
      message: result
        ? 'Invalid Bearer token incorrectly accepted'
        : 'Invalid Bearer token correctly rejected',
      details: { authHeader: 'Bearer wrong-password', result },
      duration: Date.now() - startTime,
    };
  }

  async testValidBasicAuth(): Promise<TestResult> {
    const startTime = Date.now();

    // Create basic auth: username:test-password -> base64
    const credentials = Buffer.from('user:test-password').toString('base64');
    const mockRequest = this.createMockRequest(`Basic ${credentials}`);
    const result = authenticate(mockRequest);

    return {
      success: result === true,
      message: result
        ? 'Valid Basic auth accepted'
        : 'Valid Basic auth rejected',
      details: {
        authHeader: `Basic ${credentials}`,
        decodedCreds: 'user:test-password',
        result,
      },
      duration: Date.now() - startTime,
    };
  }

  async testInvalidBasicAuth(): Promise<TestResult> {
    const startTime = Date.now();

    // Create basic auth with wrong password
    const credentials = Buffer.from('user:wrong-password').toString('base64');
    const mockRequest = this.createMockRequest(`Basic ${credentials}`);
    const result = authenticate(mockRequest);

    return {
      success: result === false,
      message: result
        ? 'Invalid Basic auth incorrectly accepted'
        : 'Invalid Basic auth correctly rejected',
      details: {
        authHeader: `Basic ${credentials}`,
        decodedCreds: 'user:wrong-password',
        result,
      },
      duration: Date.now() - startTime,
    };
  }

  async testMissingAuthHeader(): Promise<TestResult> {
    const startTime = Date.now();

    const mockRequest = this.createMockRequest(null);
    const result = authenticate(mockRequest);

    return {
      success: result === false,
      message: result
        ? 'Missing auth header incorrectly accepted'
        : 'Missing auth header correctly rejected',
      details: { authHeader: null, result },
      duration: Date.now() - startTime,
    };
  }

  async testEmptyAuthHeader(): Promise<TestResult> {
    const startTime = Date.now();

    const mockRequest = this.createMockRequest('');
    const result = authenticate(mockRequest);

    return {
      success: result === false,
      message: result
        ? 'Empty auth header incorrectly accepted'
        : 'Empty auth header correctly rejected',
      details: { authHeader: '', result },
      duration: Date.now() - startTime,
    };
  }

  async testMalformedBearerToken(): Promise<TestResult> {
    const startTime = Date.now();

    const testCases = [
      'Bearer', // Missing token
      'Bearer ', // Missing token with space
      'Bearer  ', // Missing token with multiple spaces
      'Bearertest-password', // Missing space
    ];

    let allPassed = true;
    const results = [];

    for (const authHeader of testCases) {
      const mockRequest = this.createMockRequest(authHeader);
      const result = authenticate(mockRequest);
      const passed = result === false; // Should reject malformed tokens

      results.push({ authHeader, result, passed });
      if (!passed) allPassed = false;
    }

    return {
      success: allPassed,
      message: allPassed
        ? 'All malformed Bearer tokens rejected'
        : 'Some malformed Bearer tokens accepted',
      details: { testCases: results },
      duration: Date.now() - startTime,
    };
  }

  async testMalformedBasicAuth(): Promise<TestResult> {
    const startTime = Date.now();

    const testCases = [
      'Basic', // Missing credentials
      'Basic ', // Missing credentials with space
      'Basic invalid-base64!@#', // Invalid base64
      'Basic ' + Buffer.from('onlyusername').toString('base64'), // Missing colon
      'Basic ' + Buffer.from(':onlypassword').toString('base64'), // Missing username
    ];

    let allPassed = true;
    const results = [];

    for (const authHeader of testCases) {
      const mockRequest = this.createMockRequest(authHeader);
      let result: boolean;
      let errorThrown = false;

      try {
        result = authenticate(mockRequest);
      } catch (error) {
        result = false;
        errorThrown = true;
      }

      const passed = result === false; // Should reject malformed basic auth

      results.push({ authHeader, result, passed, errorThrown });
      if (!passed) allPassed = false;
    }

    return {
      success: allPassed,
      message: allPassed
        ? 'All malformed Basic auth rejected'
        : 'Some malformed Basic auth accepted',
      details: { testCases: results },
      duration: Date.now() - startTime,
    };
  }

  async testUnsupportedAuthScheme(): Promise<TestResult> {
    const startTime = Date.now();

    const testCases = [
      'Digest realm="example"',
      'NTLM TlRMTVNTUAABAAAA',
      'ApiKey test-password',
      'JWT eyJhbGciOiJIUzI1NiJ9...',
      'Custom test-password',
    ];

    let allPassed = true;
    const results = [];

    for (const authHeader of testCases) {
      const mockRequest = this.createMockRequest(authHeader);
      const result = authenticate(mockRequest);
      const passed = result === false; // Should reject unsupported schemes

      results.push({ authHeader, result, passed });
      if (!passed) allPassed = false;
    }

    return {
      success: allPassed,
      message: allPassed
        ? 'All unsupported auth schemes rejected'
        : 'Some unsupported auth schemes accepted',
      details: { testCases: results },
      duration: Date.now() - startTime,
    };
  }

  async testCaseSensitivity(): Promise<TestResult> {
    const startTime = Date.now();

    const testCases = [
      { header: 'bearer test-password', shouldPass: false }, // lowercase bearer
      { header: 'BEARER test-password', shouldPass: false }, // uppercase bearer
      {
        header: 'basic ' + Buffer.from('user:test-password').toString('base64'),
        shouldPass: false,
      }, // lowercase basic
      {
        header: 'BASIC ' + Buffer.from('user:test-password').toString('base64'),
        shouldPass: false,
      }, // uppercase basic
      { header: 'Bearer test-password', shouldPass: true }, // correct case
      {
        header: 'Basic ' + Buffer.from('user:test-password').toString('base64'),
        shouldPass: true,
      }, // correct case
    ];

    let allPassed = true;
    const results = [];

    for (const testCase of testCases) {
      const mockRequest = this.createMockRequest(testCase.header);
      const result = authenticate(mockRequest);
      const passed = result === testCase.shouldPass;

      results.push({
        header: testCase.header,
        expected: testCase.shouldPass,
        actual: result,
        passed,
      });

      if (!passed) allPassed = false;
    }

    return {
      success: allPassed,
      message: allPassed
        ? 'Case sensitivity handled correctly'
        : 'Case sensitivity issues found',
      details: { testCases: results },
      duration: Date.now() - startTime,
    };
  }
}

// CLI runner
if (require.main === module) {
  const tester = new AuthenticationTests();
  tester
    .runAllTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      TestLogger.error('Authentication test suite crashed', error);
      process.exit(1);
    });
}

export { AuthenticationTests };
