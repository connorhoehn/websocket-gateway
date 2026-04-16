const { describe, it, expect } = require('@jest/globals');
const Y = require('yjs');

describe('section deduplication', () => {
    function createDocWithSections(titles) {
        const ydoc = new Y.Doc();
        const ySections = ydoc.getArray('sections');
        for (const title of titles) {
            const section = new Y.Map();
            section.set('id', Math.random().toString(36).slice(2));
            section.set('title', title);
            section.set('type', 'notes');
            ySections.push([section]);
        }
        return ydoc;
    }

    function deduplicateSections(ydoc) {
        const ySections = ydoc.getArray('sections');
        const seen = new Set();
        const toRemove = [];
        for (let i = 0; i < ySections.length; i++) {
            const section = ySections.get(i);
            const title = section instanceof Y.Map ? section.get('title') : null;
            if (!title) continue;
            if (seen.has(title)) {
                toRemove.push(i);
            } else {
                seen.add(title);
            }
        }
        ydoc.transact(() => {
            for (let i = toRemove.length - 1; i >= 0; i--) {
                ySections.delete(toRemove[i], 1);
            }
        });
        return toRemove.length;
    }

    it('removes duplicate sections keeping first of each title', () => {
        const ydoc = createDocWithSections(['Agenda', 'Discussion', 'Agenda', 'Discussion', 'Agenda']);
        const removed = deduplicateSections(ydoc);
        expect(removed).toBe(3);
        const ySections = ydoc.getArray('sections');
        expect(ySections.length).toBe(2);
        expect(ySections.get(0).get('title')).toBe('Agenda');
        expect(ySections.get(1).get('title')).toBe('Discussion');
    });

    it('preserves unique sections', () => {
        const ydoc = createDocWithSections(['A', 'B', 'C']);
        const removed = deduplicateSections(ydoc);
        expect(removed).toBe(0);
        expect(ydoc.getArray('sections').length).toBe(3);
    });

    it('handles empty document', () => {
        const ydoc = new Y.Doc();
        ydoc.getArray('sections'); // ensure it exists
        const removed = deduplicateSections(ydoc);
        expect(removed).toBe(0);
    });

    it('handles 5x template duplication (20 sections -> 4)', () => {
        const template = ['Agenda', 'Discussion', 'Action Items', 'Decisions'];
        const titles = [...template, ...template, ...template, ...template, ...template];
        const ydoc = createDocWithSections(titles);
        expect(ydoc.getArray('sections').length).toBe(20);
        const removed = deduplicateSections(ydoc);
        expect(removed).toBe(16);
        expect(ydoc.getArray('sections').length).toBe(4);
    });
});
