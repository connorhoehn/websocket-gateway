const { describe, it, expect } = require('@jest/globals');

describe('auth-middleware displayName extraction', () => {
    // Simulate the extraction logic from auth-middleware.js
    function extractDisplayName(claims) {
        const givenName = claims.given_name || claims['custom:given_name'] || '';
        const familyName = claims.family_name || claims['custom:family_name'] || '';
        return [givenName, familyName].filter(Boolean).join(' ') || claims.email || null;
    }

    it('extracts given + family name', () => {
        expect(extractDisplayName({ given_name: 'John', family_name: 'Doe', email: 'j@x.com' }))
            .toBe('John Doe');
    });

    it('uses given name only when no family name', () => {
        expect(extractDisplayName({ given_name: 'Alice', email: 'a@x.com' }))
            .toBe('Alice');
    });

    it('falls back to email when no name claims', () => {
        expect(extractDisplayName({ email: 'bob@example.com' }))
            .toBe('bob@example.com');
    });

    it('returns null when nothing available', () => {
        expect(extractDisplayName({})).toBeNull();
    });

    it('handles custom: prefixed claims', () => {
        expect(extractDisplayName({ 'custom:given_name': 'Carol', 'custom:family_name': 'Smith' }))
            .toBe('Carol Smith');
    });
});
