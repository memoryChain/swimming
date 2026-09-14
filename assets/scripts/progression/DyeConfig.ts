/** 染色剂永久解锁的新增配色；已有免费配色不在此表。 */
export const DYE_COLORS: readonly { id: string; label: string; suit: readonly [number, number, number]; cap: readonly [number, number, number]; cost: number }[] = [
    { id: 'cup-gold', label: '冠军金', suit: [235, 181, 44], cap: [235, 181, 44], cost: 2 },
    { id: 'cup-aurora', label: '极光紫', suit: [120, 75, 205], cap: [120, 75, 205], cost: 2 },
    { id: 'cup-glacier', label: '冰川蓝', suit: [119, 212, 235], cap: [119, 212, 235], cost: 2 },
];
