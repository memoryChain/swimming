'use strict';
const COLLECTIONS = new Set(['players', 'operations', 'adminAudit', 'counters', 'gameConfig']);
/** 集合前缀来自部署包，绝不接受客户端指定；同一云套餐内隔离开发数据。 */
function scopeDatabase(db, prefix) {
    if (prefix !== '' && prefix !== 'dev_') throw Error('部署集合前缀无效');
    function scope(source) {
        return { collection(name) {
            if (!COLLECTIONS.has(name)) throw Error('未知云集合');
            return source.collection(prefix + name);
        } };
    }
    return { ...scope(db), runTransaction: work => db.runTransaction(tx => work(scope(tx))) };
}
module.exports = { scopeDatabase };
