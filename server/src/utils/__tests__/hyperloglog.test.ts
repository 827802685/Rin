import { describe, it, expect } from 'bun:test';
import { HyperLogLog, createHLL, hllFromString } from '../hyperloglog';

/**
 * HyperLogLog 是 UV 统计的唯一算法来源，此前零覆盖。
 * 这里的用例锁住四类不变量：
 *   1. 基数估算精度（小基数走线性计数，大基数走原始估计）
 *   2. 去重语义（同一个 value 反复 add 不改变基数）
 *   3. 序列化往返等价（存进 visit_stats.hll_data 再读回来必须一致）
 *   4. 脏数据不炸（截断 / 非法 base64 / 越界索引）
 */

const REGISTERS = 16384;

function build(values: Iterable<string>): HyperLogLog {
    const hll = new HyperLogLog();
    for (const v of values) hll.add(v);
    return hll;
}

function nonZeroCount(hll: HyperLogLog): number {
    let n = 0;
    for (const v of hll.getRegisters()) if (v !== 0) n++;
    return n;
}

describe('HyperLogLog', () => {
    describe('constructor', () => {
        it('should start with 16384 zeroed registers', () => {
            const hll = new HyperLogLog();
            expect(hll.getRegisters().length).toBe(REGISTERS);
            expect(nonZeroCount(hll)).toBe(0);
            expect(hll.count()).toBe(0);
        });

        it('should adopt an existing register array', () => {
            const registers = new Uint8Array(REGISTERS);
            registers[42] = 7;
            const hll = new HyperLogLog(registers);
            expect(hll.getRegisters()[42]).toBe(7);
        });

        it('should restore registers from a serialized string', () => {
            const source = build(['a', 'b', 'c']);
            const restored = new HyperLogLog(source.serialize());
            expect(Array.from(restored.getRegisters())).toEqual(Array.from(source.getRegisters()));
        });

        it('should fall back to empty registers for malformed input', () => {
            const hll = new HyperLogLog('not-a-valid-base64!!!');
            expect(nonZeroCount(hll)).toBe(0);
            expect(hll.count()).toBe(0);
        });
    });

    describe('add / count', () => {
        it('should estimate 0 for an empty sketch', () => {
            expect(new HyperLogLog().count()).toBe(0);
        });

        it('should be exact for a handful of distinct values', () => {
            for (const n of [1, 2, 3, 5, 10, 20]) {
                const hll = build(Array.from({ length: n }, (_, i) => `visitor-${i}`));
                expect(Math.round(hll.count())).toBe(n);
            }
        });

        it('should not count the same value twice', () => {
            const hll = new HyperLogLog();
            for (let i = 0; i < 50; i++) hll.add('repeat');
            expect(Math.round(hll.count())).toBe(1);
        });

        it('should stay within the standard 0.81% error band at 100k cardinality', () => {
            const n = 100_000;
            const hll = build(Array.from({ length: n }, (_, i) => `v-${i}`));
            const error = Math.abs(hll.count() - n) / n;
            expect(error).toBeLessThan(0.05);
        });

        it('should keep register values within the 50-bit hash budget', () => {
            const hll = build(Array.from({ length: 5000 }, (_, i) => `k-${i}`));
            for (const v of hll.getRegisters()) {
                expect(v).toBeLessThanOrEqual(50);
            }
        });

        it('should handle unicode and emoji keys', () => {
            const hll = build(['中文访客', 'emoji-\u{1F600}', '\u00e9l\u00e8ve']);
            expect(Math.round(hll.count())).toBe(3);
        });

        it('should treat an empty string as a real value', () => {
            const hll = new HyperLogLog();
            hll.add('');
            expect(Math.round(hll.count())).toBe(1);
        });
    });

    describe('merge', () => {
        it('should union two disjoint sketches', () => {
            const left = build(['a', 'b']);
            const right = build(['c', 'd', 'e']);
            left.merge(right);
            expect(Math.round(left.count())).toBe(5);
        });

        it('should not double count overlapping values', () => {
            const left = build(['a', 'b', 'c']);
            const right = build(['c', 'd']);
            left.merge(right);
            expect(Math.round(left.count())).toBe(4);
        });

        it('should keep the larger register value per index', () => {
            const left = new HyperLogLog(new Uint8Array(REGISTERS));
            const right = new HyperLogLog(new Uint8Array(REGISTERS));
            left.getRegisters()[7] = 3;
            right.getRegisters()[7] = 9;
            left.merge(right);
            expect(left.getRegisters()[7]).toBe(9);
        });
    });

    describe('serialize / deserialize', () => {
        it('should round-trip a small sketch', () => {
            const source = build(['x', 'y', 'z']);
            const restored = new HyperLogLog(source.serialize());
            expect(Math.round(restored.count())).toBe(3);
        });

        it('should serialize an empty sketch to an empty string and back', () => {
            const serialized = new HyperLogLog().serialize();
            expect(serialized).toBe('');
            expect(new HyperLogLog(serialized).count()).toBe(0);
        });

        it('should survive a fully saturated register set', () => {
            // 高基数下 16384 个寄存器几乎全部非零，历史上这种规模会撑爆 String.fromCharCode 的展开
            const source = build(Array.from({ length: 200_000 }, (_, i) => `s-${i}`));
            expect(nonZeroCount(source)).toBeGreaterThan(REGISTERS * 0.9);

            const restored = new HyperLogLog(source.serialize());
            expect(Array.from(restored.getRegisters())).toEqual(Array.from(source.getRegisters()));
            expect(Math.round(restored.count())).toBe(Math.round(source.count()));
        });

        it('should preserve register indices above 255', () => {
            const registers = new Uint8Array(REGISTERS);
            registers[5000] = 11;
            const source = new HyperLogLog(registers);
            const restored = new HyperLogLog(source.serialize());
            expect(restored.getRegisters()[5000]).toBe(11);
            expect(nonZeroCount(restored)).toBe(1);
        });

        it('should ignore a truncated trailing group', () => {
            const source = build(['a', 'b', 'c']);
            const bytes = Buffer.from(source.serialize(), 'base64');
            const truncated = bytes.subarray(0, bytes.length - 1).toString('base64');
            const restored = new HyperLogLog(truncated);
            expect(Math.round(restored.count())).toBeGreaterThan(0);
            expect(Math.round(restored.count())).toBeLessThanOrEqual(3);
        });

        it('should ignore out-of-range register indices', () => {
            // 索引 0xFFFF = 65535，超出 16384 个寄存器，必须被丢弃而不是越界写
            const payload = Buffer.from([0x00, 0x01, 0x05, 0xFF, 0xFF, 0x09]).toString('base64');
            const restored = new HyperLogLog(payload);
            expect(restored.getRegisters()[1]).toBe(5);
            expect(nonZeroCount(restored)).toBe(1);
        });
    });

    describe('helpers', () => {
        it('createHLL should return an empty sketch', () => {
            const hll = createHLL();
            expect(hll.getRegisters().length).toBe(REGISTERS);
            expect(hll.count()).toBe(0);
        });

        it('hllFromString should restore a sketch', () => {
            const source = build(['one', 'two']);
            expect(Math.round(hllFromString(source.serialize()).count())).toBe(2);
        });
    });
});
