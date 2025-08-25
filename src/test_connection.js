import { ClickHouse } from 'clickhouse';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// ClickHouse 数据库连接配置
const clickhouse = new ClickHouse({
    url: process.env.CLICKHOUSE_HOST || '192.168.1.18',
    port: process.env.CLICKHOUSE_PORT || 8123,
    debug: false,
    basicAuth: {
        username: process.env.CLICKHOUSE_USER || 'clickhouse',
        password: process.env.CLICKHOUSE_PASSWORD || 'zktl2025',
    },
    isUseGzip: false,
    format: 'json',
    raw: false,
    config: {
        session_timeout: 60,
        output_format_json_quote_64bit_integers: 0,
    },
});

// 测试连接并查询最新 ID
async function testConnectionAndQuery() {
    try {
        console.log('🔍 测试云端 ClickHouse 连接...');
        console.log('📍 连接信息:');
        console.log(`   Host: ${process.env.CLICKHOUSE_HOST || '192.168.1.18'}`);
        console.log(`   Port: ${process.env.CLICKHOUSE_PORT || 8123}`);
        console.log(`   Database: ${process.env.CLICKHOUSE_DATABASE || 'yiqunzhixiu_db'}`);
        console.log(`   User: ${process.env.CLICKHOUSE_USER || 'clickhouse'}`);
        console.log(`   Password: ${process.env.CLICKHOUSE_PASSWORD || 'zktl2025'}`);
        
        // 测试连接
        const testQuery = 'SELECT 1 as test';
        const testResult = await clickhouse.query(testQuery).toPromise();
        
        if (testResult && testResult.length > 0) {
            console.log('✅ 数据库连接成功');
        } else {
            console.log('❌ 数据库连接失败');
            return;
        }
        
        // 查询 sales_orders 表的最新记录
        console.log('\n📋 查询 sales_orders 表的最新记录...');
        const salesQuery = `
            SELECT id, receive_time, 'sales_orders' as table_name
            FROM yiqunzhixiu_db.sales_orders 
            WHERE receive_time IS NOT NULL
            ORDER BY receive_time DESC 
            LIMIT 1
        `;
        
        const salesResult = await clickhouse.query(salesQuery).toPromise();
        
        if (salesResult && salesResult.length > 0) {
            console.log('✅ sales_orders 表最新记录:');
            console.log(`   ID: ${salesResult[0].id}`);
            console.log(`   时间: ${salesResult[0].receive_time}`);
        } else {
            console.log('⚠️ sales_orders 表中没有找到记录');
        }
        
        // 查询 production_orders 表的最新记录
        console.log('\n📋 查询 production_orders 表的最新记录...');
        const productionQuery = `
            SELECT id, receive_time, 'production_orders' as table_name
            FROM yiqunzhixiu_db.production_orders 
            WHERE receive_time IS NOT NULL
            ORDER BY receive_time DESC 
            LIMIT 1
        `;
        
        const productionResult = await clickhouse.query(productionQuery).toPromise();
        
        if (productionResult && productionResult.length > 0) {
            console.log('✅ production_orders 表最新记录:');
            console.log(`   ID: ${productionResult[0].id}`);
            console.log(`   时间: ${productionResult[0].receive_time}`);
        } else {
            console.log('⚠️ production_orders 表中没有找到记录');
        }
        
        // 查询两个表中的最新记录（用于爬虫断点）
        console.log('\n📋 查询所有表中的最新记录（用于爬虫断点）...');
        const latestQuery = `
            SELECT id, receive_time, table_name
            FROM (
                SELECT id, receive_time, 'sales_orders' as table_name
                FROM yiqunzhixiu_db.sales_orders 
                WHERE receive_time IS NOT NULL
                ORDER BY receive_time DESC 
                LIMIT 1
                
                UNION ALL
                
                SELECT id, receive_time, 'production_orders' as table_name
                FROM yiqunzhixiu_db.production_orders 
                WHERE receive_time IS NOT NULL
                ORDER BY receive_time DESC 
                LIMIT 1
            )
            ORDER BY receive_time DESC 
            LIMIT 1
        `;
        
        const latestResult = await clickhouse.query(latestQuery).toPromise();
        
        if (latestResult && latestResult.length > 0) {
            console.log('🎯 爬虫断点信息:');
            console.log(`   最新 ID: ${latestResult[0].id}`);
            console.log(`   最新时间: ${latestResult[0].receive_time}`);
            console.log(`   来源表: ${latestResult[0].table_name}`);
        } else {
            console.log('⚠️ 没有找到任何记录，爬虫将从开始位置开始');
        }
        
        // 查询表的总记录数
        console.log('\n📊 查询表的总记录数...');
        const countQuery = `
            SELECT 
                (SELECT COUNT(*) FROM yiqunzhixiu_db.sales_orders) as sales_count,
                (SELECT COUNT(*) FROM yiqunzhixiu_db.production_orders) as production_count
        `;
        
        const countResult = await clickhouse.query(countQuery).toPromise();
        
        if (countResult && countResult.length > 0) {
            console.log('📈 数据库统计:');
            console.log(`   sales_orders 表: ${countResult[0].sales_count} 条记录`);
            console.log(`   production_orders 表: ${countResult[0].production_count} 条记录`);
            console.log(`   总计: ${parseInt(countResult[0].sales_count) + parseInt(countResult[0].production_count)} 条记录`);
        }
        
        console.log('\n🎉 连接测试完成！');
        
    } catch (error) {
        console.error('❌ 连接测试失败:');
        console.error('   错误类型:', error.name);
        console.error('   错误消息:', error.message);
        console.error('   错误代码:', error.code);
        
        if (error.code === 'ECONNREFUSED') {
            console.error('   💡 提示: 无法连接到服务器，请检查:');
            console.error('      - 服务器地址是否正确 (192.168.1.18)');
            console.error('      - 端口是否正确 (8123)');
            console.error('      - 网络连接是否正常');
        } else if (error.code === 'ENOTFOUND') {
            console.error('   💡 提示: 无法解析主机名，请检查:');
            console.error('      - 服务器地址是否正确');
            console.error('      - DNS 解析是否正常');
        } else if (error.message.includes('Authentication failed')) {
            console.error('   💡 提示: 认证失败，请检查:');
            console.error('      - 用户名和密码是否正确');
            console.error('      - 用户是否有访问权限');
        }
    } finally {
        // 注意：新版本的 clickhouse 包不需要手动关闭连接
        // 连接会自动管理
        console.log('\n🔒 连接已自动管理，无需手动关闭');
    }
}

// 运行测试
testConnectionAndQuery(); 