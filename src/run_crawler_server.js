import express from 'express';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ClickHouse } from 'clickhouse';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.CRAWLER_SERVER_PORT || 3000;

// ClickHouse 数据库连接配置
let clickhouse = null;

function createClickHouseConnection() {
    return new ClickHouse({
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
}

// 从数据库获取最新 ID
async function getLatestIdFromDatabase() {
    try {
        // 如果连接不存在或已断开，重新创建连接
        if (!clickhouse) {
            clickhouse = createClickHouseConnection();
        }
        
        console.log('🔍 从 ClickHouse 数据库获取最新 ID...');
        
        // 分别查询两个表的最新记录，然后比较选择最新的
        const salesQuery = `
            SELECT id, receive_time, 'sales_orders' as table_name
            FROM yiqunzhixiu_db.sales_orders 
            WHERE receive_time IS NOT NULL
            ORDER BY receive_time DESC 
            LIMIT 1
        `;
        
        const productionQuery = `
            SELECT id, receive_time, 'production_orders' as table_name
            FROM yiqunzhixiu_db.production_orders 
            WHERE receive_time IS NOT NULL
            ORDER BY receive_time DESC 
            LIMIT 1
        `;
        
        const salesResult = await clickhouse.query(salesQuery).toPromise();
        const productionResult = await clickhouse.query(productionQuery).toPromise();
        
        // 比较两个结果，选择最新的
        let latestRecord = null;
        if (salesResult && salesResult.length > 0 && productionResult && productionResult.length > 0) {
            const salesTime = new Date(salesResult[0].receive_time);
            const productionTime = new Date(productionResult[0].receive_time);
            
            if (salesTime > productionTime) {
                latestRecord = salesResult[0];
            } else {
                latestRecord = productionResult[0];
            }
        } else if (salesResult && salesResult.length > 0) {
            latestRecord = salesResult[0];
        } else if (productionResult && productionResult.length > 0) {
            latestRecord = productionResult[0];
        }
        
        if (latestRecord) {
            const latestId = latestRecord.id;
            const latestTime = latestRecord.receive_time;
            const tableName = latestRecord.table_name;
            console.log('✅ 从数据库获取到最新 ID:', latestId, '时间:', latestTime, '表:', tableName);
            return latestId;
        } else {
            console.log('⚠️ 数据库中没有找到订单记录');
            return null;
        }
    } catch (error) {
        console.error('❌ 从数据库获取最新 ID 失败:', error);
        // 重置连接，下次重试
        clickhouse = null;
        return null;
    }
}

// 执行主程序（爬取、处理、上传一体化）
async function executeMainCrawler(lastId = null) {
    try {
        console.log('🚀 开始执行主爬虫程序...');
        
        // 构建主程序命令
        let mainCmd = 'node src/main.js --page 1';
        
        if (lastId) {
            mainCmd += ` --since-id ${lastId}`;
        }
        
        // 默认启用上传
        mainCmd += ' --upload';
        
        console.log('执行主程序命令:', mainCmd);
        
        // 执行主程序
        execSync(mainCmd, { 
            stdio: 'inherit',
            cwd: path.join(__dirname, '..')
        });
        
        console.log('✅ 主程序执行完成');
        return true;
        
    } catch (error) {
        console.error('❌ 主程序执行失败:', error);
        return false;
    }
}

// 执行主程序并获取订单数据
async function executeMainCrawlerWithData(lastId = null) {
    try {
        console.log('🚀 开始执行主爬虫程序并获取数据...');
        
        // 构建主程序命令（不上传，只输出数据）
        let mainCmd = 'node src/main.js --page 1';
        
        if (lastId) {
            mainCmd += ` --since-id ${lastId}`;
        }
        
        // 不上传，只输出数据
        mainCmd += ' --no-upload';
        
        console.log('执行主程序命令:', mainCmd);
        
        // 执行主程序并捕获输出
        const result = execSync(mainCmd, { 
            encoding: 'utf8',
            cwd: path.join(__dirname, '..')
        });
        
        console.log('✅ 主程序执行完成');
        
        // 尝试从输出中提取JSON数据
        let ordersData = null;
        try {
            // 查找JSON格式的订单数据
            const jsonMatch = result.match(/📊 订单数据 \(JSON格式\):\s*(\{[\s\S]*?\n\})/);
            if (jsonMatch) {
                const jsonStr = jsonMatch[1];
                ordersData = JSON.parse(jsonStr);
                console.log('✅ 成功提取订单数据');
                
                // 确保数据格式符合要求
                if (ordersData) {
                    // 确保所有必要的字段都存在
                    if (!ordersData.salesOrders) ordersData.salesOrders = [];
                    if (!ordersData.productionOrders) ordersData.productionOrders = [];
                    if (!ordersData.salesDetails) ordersData.salesDetails = [];
                    if (!ordersData.materialDetails) ordersData.materialDetails = [];
                    
                    console.log(`📊 数据统计: 销售订单 ${ordersData.salesOrders.length} 个, 生产订单 ${ordersData.productionOrders.length} 个, 销售明细 ${ordersData.salesDetails.length} 个, 物料明细 ${ordersData.materialDetails.length} 个`);
                }
            } else {
                console.log('⚠️ 未找到JSON格式的订单数据');
            }
        } catch (parseError) {
            console.error('❌ 解析订单数据失败:', parseError);
        }
        
        return {
            success: true,
            ordersData: ordersData
        };
        
    } catch (error) {
        console.error('❌ 主程序执行失败:', error);
        return {
            success: false,
            ordersData: null
        };
    }
}

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 日志中间件
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// 健康检查端点
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'yqzx-crawler-server'
    });
});

// 主爬虫触发端点
app.post('/trigger-crawler', async (req, res) => {
    try {
        const { last_id } = req.body; // 接收上次的最新ID
        
        console.log('🚀 收到爬虫触发请求，上次ID:', last_id);
        
        const startTime = Date.now();
        
        // 执行主程序并获取数据
        const result = await executeMainCrawlerWithData(last_id);
        
        const endTime = Date.now();
        
        const response = {
            success: result.success,
            timestamp: new Date().toISOString(),
            execution_time_ms: endTime - startTime,
            latest_id: result.ordersData?.salesOrders?.[0]?.id || last_id, // 使用订单数据中的ID
            last_checked_id: last_id, // 返回上次检查的ID
            message: result.success 
                ? '爬虫程序执行成功，已获取最新公告内容并上传到云端' 
                : '爬虫程序执行失败',
            // 添加订单数据
            orders_data: result.ordersData || null
        };
        
        console.log('✅ 爬虫触发完成:', response);
        res.json(response);
        
    } catch (error) {
        console.error('❌ 爬虫执行失败:', error);
        res.status(500).json({
            success: false,
            timestamp: new Date().toISOString(),
            error: error.message,
            message: '爬虫执行失败'
        });
    }
});

// 获取爬虫状态端点
app.get('/status', async (req, res) => {
    try {
        const status = {
            timestamp: new Date().toISOString(),
            last_crawled_id: null,
            total_orders_count: 0,
            last_update: null
        };
        
        // 从数据库获取最新 ID
        status.last_crawled_id = await getLatestIdFromDatabase();
        
        // 读取总订单数（从数据库）
        try {
            if (clickhouse) {
                const countQuery = `
                    SELECT 
                        (SELECT COUNT(*) FROM yiqunzhixiu_db.sales_orders) + 
                        (SELECT COUNT(*) FROM yiqunzhixiu_db.production_orders) as total
                `;
                const countResult = await clickhouse.query(countQuery).toPromise();
                status.total_orders_count = countResult[0]?.total || 0;
            }
        } catch (e) {
            console.error('获取数据库订单总数失败:', e);
            // 回退到本地文件
            const allOrdersFile = path.join(__dirname, '..', 'outsofts_orders_all.json');
            if (fs.existsSync(allOrdersFile)) {
                try {
                    const allOrders = JSON.parse(fs.readFileSync(allOrdersFile, 'utf8'));
                    status.total_orders_count = Array.isArray(allOrders) ? allOrders.length : 0;
                    
                    // 获取文件修改时间
                    const stats = fs.statSync(allOrdersFile);
                    status.last_update = stats.mtime.toISOString();
                } catch (e) {
                    console.error('读取outsofts_orders_all.json失败:', e);
                }
            }
        }
        
        res.json(status);
        
    } catch (error) {
        console.error('获取状态失败:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 手动触发爬虫端点（带参数）
app.post('/crawl', async (req, res) => {
    try {
        const { page = 1, headless = true, orders = 0, skip = 0, upload = true } = req.body;
        
        console.log('🚀 收到手动爬虫请求:', { page, headless, orders, skip, upload });
        
        // 构建主程序命令
        let mainCmd = `node src/main.js --page ${page}`;
        
        mainCmd += ` --headless ${headless ? 'true' : 'false'}`;
        if (orders > 0) mainCmd += ` --orders ${orders}`;
        if (skip > 0) mainCmd += ` --skip ${skip}`;
        if (!upload) mainCmd += ' --no-upload';
        
        console.log('执行主程序命令:', mainCmd);
        
        const startTime = Date.now();
        execSync(mainCmd, { 
            stdio: 'inherit',
            cwd: path.join(__dirname, '..')
        });
        const endTime = Date.now();
        
        const response = {
            success: true,
            timestamp: new Date().toISOString(),
            execution_time_ms: endTime - startTime,
            parameters: { page, headless, orders, skip, upload },
            message: `成功爬取第 ${page} 页公告内容`
        };
        
        console.log('✅ 手动爬虫执行完成:', response);
        res.json(response);
        
    } catch (error) {
        console.error('❌ 手动爬虫执行失败:', error);
        
        res.status(500).json({
            success: false,
            timestamp: new Date().toISOString(),
            error: error.message,
            message: '手动爬虫执行失败'
        });
    }
});

// 错误处理中间件
app.use((error, req, res, next) => {
    console.error('服务器错误:', error);
    res.status(500).json({
        success: false,
        error: error.message,
        message: '服务器内部错误'
    });
});

// 404 处理
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: '端点不存在',
        available_endpoints: [
            'GET /health',
            'POST /trigger-crawler',
            'GET /status',
            'POST /crawl'
        ]
    });
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`🚀 YQZX 爬虫服务器已启动`);
    console.log(`📍 服务器地址: http://localhost:${PORT}`);
    console.log(`📋 可用端点:`);
    console.log(`   - GET  /health - 健康检查`);
    console.log(`   - POST /trigger-crawler - 触发爬虫（自动获取最新ID）`);
    console.log(`   - GET  /status - 获取状态`);
    console.log(`   - POST /crawl - 手动爬虫（带参数）`);
    console.log(`⏰ 启动时间: ${new Date().toISOString()}`);
    console.log(`💡 使用新的main.js程序，支持爬取、处理、上传一体化`);
});

// 优雅关闭
process.on('SIGINT', () => {
    console.log('\n🛑 收到关闭信号，正在优雅关闭服务器...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 收到终止信号，正在优雅关闭服务器...');
    process.exit(0);
}); 