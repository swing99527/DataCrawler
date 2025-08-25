import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';

// 登录凭据
const LOGIN_CREDENTIALS = {
    username: process.env.OUTSOFTS_USERNAME || '13692075699',
    password: process.env.OUTSOFTS_PASSWORD || 'aa7580141'
};

// N8N Webhook配置
const N8N_CONFIG = {
    webhookUrl: process.env.N8N_WEBHOOK_URL || 'http://192.168.1.110:5678/webhook-test/3d3b99f1-26b5-40d3-ac31-289b3c002297'
};

// 全局变量存储Flow_Detail响应
let flowDetailResponses = new Map();

// 爬取配置
const CRAWL_CONFIG = {
    pageSize: 100,
    delayBetweenPages: 3000,
    delayBetweenOrders: 3000,
    enableIncremental: false,
    saveInterval: 5,
    maxRetries: 3,
    retryDelay: 2000
};

// 解析命令行参数
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        page: 1,
        headless: true,
        orderCount: 0,
        skip: 0,
        sinceId: null,
        output: null,
        upload: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '--page':
            case '-p':
                options.page = parseInt(args[++i]) || 1;
                break;
            case '--headless':
            case '-h': {
                const next = args[i + 1];
                if (next && !next.startsWith('-')) {
                    i++;
                    const val = String(next).toLowerCase();
                    options.headless = !(val === 'false' || val === '0' || val === 'no');
                } else {
                    options.headless = true;
                }
                break;
            }
            case '--orders':
            case '-o':
                options.orderCount = parseInt(args[++i]) || 0;
                break;
            case '--skip':
            case '-s':
                options.skip = parseInt(args[++i]) || 0;
                break;
            case '--since-id':
            case '--last-id':
                options.sinceId = args[++i];
                break;
            case '--no-upload':
                options.upload = false;
                break;
            case '--upload':
                options.upload = true;
                break;
            case '--help':
                console.log(`
用法: node src/main.js [选项]

选项:
  -p, --page <number>     指定爬取的页面编号 (默认: 1)
  -h, --headless <bool>   是否使用无头模式 (默认: true)
  -o, --orders <number>   限制处理的订单数量 (默认: 0, 表示处理所有)
  -s, --skip <number>     跳过前N条公告再开始处理 (默认: 0)
  --since-id <id>         上次同步的last_id
  --no-upload             不上传到云端，只输出到控制台 (默认行为)
  --upload                上传到云端
  --help                  显示帮助信息

示例:
  node src/main.js -p 3 -s 20 -o 80
  node src/main.js --since-id f920b8b3118f4ec883eef7efc007b68e
                `);
                process.exit(0);
        }
    }

    return options;
}

// 登录函数
async function login(page) {
    console.log('正在登录 outsofts.net...');
    
    try {
        await page.goto('https://outsofts.net/user/login', { 
            waitUntil: 'domcontentloaded',
            timeout: 60000 
        });
        
        await page.waitForTimeout(3000);
        
        await page.fill('#userName', LOGIN_CREDENTIALS.username);
        console.log('已输入用户名');
        
        await page.fill('#password', LOGIN_CREDENTIALS.password);
        console.log('已输入密码');
        
        await page.click('button[type="submit"]');
        console.log('已点击登录按钮');
        
        await page.waitForTimeout(8000);
        
        const currentUrl = page.url();
        console.log(`当前URL: ${currentUrl}`);
        
        if (currentUrl.includes('/login')) {
            console.log('登录失败，仍在登录页面');
            return false;
        } else {
            console.log('登录成功');
            return true;
        }
        
    } catch (error) {
        console.error('登录失败:', error);
        return false;
    }
}

// 设置网络请求监听
async function setupNetworkListener(page) {
    console.log('设置网络请求监听器...');
    
    page.on('response', async (response) => {
        const url = response.url();
        
        if (url.includes('Flow_Detail') || url.includes('businessapi.outsofts.net/sys/flow/Flow_Detail')) {
            console.log(`捕获到Flow_Detail请求: ${url}`);
            
            try {
                const responseData = await response.json();
                console.log(`Flow_Detail响应数据大小: ${JSON.stringify(responseData).length} 字符`);
                
                const requestId = `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
                flowDetailResponses.set(requestId, {
                    url: url,
                    data: responseData,
                    timestamp: new Date().toISOString(),
                    headers: response.headers()
                });
                
                console.log(`已保存Flow_Detail响应，ID: ${requestId}`);
                
            } catch (error) {
                console.error('解析Flow_Detail响应失败:', error);
            }
        }
    });
}

// 导航到指定页面
async function navigateToSpecificPage(page, targetPage) {
    console.log(`正在导航到第 ${targetPage} 页...`);

    try {
        try {
            await page.waitForSelector('.ant-pagination', { timeout: 15000 });
        } catch (e) {
            console.log('等待分页器超时，尝试直接翻页...');
        }

        const currentPageElement = await page.$('.ant-pagination-item-active');
        if (currentPageElement) {
            const currentPageText = await currentPageElement.textContent();
            const currentPage = parseInt(currentPageText);
            console.log(`当前在第 ${currentPage} 页`);

            if (currentPage === targetPage) {
                console.log('已在目标页面');
                return true;
            }
        }

        const targetPageSelector = `.ant-pagination-item[title="${targetPage}"]`;
        const targetPageElement = await page.$(targetPageSelector);

        if (targetPageElement) {
            console.log(`找到第 ${targetPage} 页按钮，点击...`);
            await targetPageElement.click();
            await page.waitForTimeout(8000);
            
            const newCurrentPageElement = await page.$('.ant-pagination-item-active');
            if (newCurrentPageElement) {
                const newCurrentPageText = await newCurrentPageElement.textContent();
                const newCurrentPage = parseInt(newCurrentPageText);
                if (newCurrentPage === targetPage) {
                    console.log(`成功到达第 ${targetPage} 页`);
                    return true;
                }
            }
        } else {
            console.log(`第 ${targetPage} 页按钮不可见，尝试使用下一页按钮`);
        }

        console.log(`使用下一页按钮翻页到第 ${targetPage} 页...`);
        
        const maxAttempts = Math.max(targetPage + 5, 30);
        
        for (let i = 0; i < maxAttempts; i++) {
            await page.waitForTimeout(3000);
            
            const currentPageElement = await page.$('.ant-pagination-item-active');
            if (currentPageElement) {
                const currentPageText = await currentPageElement.textContent();
                const currentPage = parseInt(currentPageText);
                console.log(`当前在第 ${currentPage} 页`);
                
                if (currentPage === targetPage) {
                    console.log(`成功到达第 ${targetPage} 页`);
                    return true;
                } else if (currentPage > targetPage) {
                    console.log(`翻页过度，当前页 ${currentPage} 超过目标页 ${targetPage}`);
                    return false;
                }
            }
            
            const nextButton = await page.$('.ant-pagination-next:not(.ant-pagination-disabled)');
            if (nextButton) {
                console.log(`点击下一页按钮 (第 ${i + 1} 次尝试)`);
                
                await nextButton.scrollIntoViewIfNeeded();
                await page.waitForTimeout(1000);
                
                await nextButton.click();
                await page.waitForTimeout(5000);
                
                try {
                    await page.waitForSelector('.ant-table', { timeout: 10000 });
                } catch (e) {
                    console.log('等待表格更新超时，继续...');
                }
                
            } else {
                console.log('没有更多页面或下一页按钮已禁用');
                break;
            }
        }

        console.log(`翻页失败，无法到达第 ${targetPage} 页`);
        return false;
    } catch (error) {
        console.error(`翻页失败: ${error.message}`);
        return false;
    }
}

// 从当前页面获取订单列表
async function getOrderListFromCurrentPage(page) {
    console.log('正在获取当前页面的订单列表...');
    
    try {
        await page.waitForTimeout(10000);
        
        const pageLoaded = await page.evaluate(() => {
            return document.readyState === 'complete';
        });
        
        console.log(`页面加载状态: ${pageLoaded ? '完成' : '未完成'}`);
        
        try {
            await page.waitForSelector('.ant-table', { timeout: 20000 });
        } catch (e) {
            console.log('等待表格元素超时，尝试继续执行...');
        }
        
        const dataCheck = await page.evaluate(() => {
            const tables = document.querySelectorAll('.ant-table');
            console.log(`找到 ${tables.length} 个表格`);
            
            for (const table of tables) {
                const dataRows = table.querySelectorAll('tbody tr:not(.ant-table-placeholder)');
                if (dataRows.length > 0) {
                    console.log(`表格中有 ${dataRows.length} 行数据`);
                    return true;
                }
            }
            return false;
        });
        
        if (!dataCheck) {
            console.log('未找到数据，等待更长时间...');
            await page.waitForTimeout(10000);
        }
        
        const orders = await page.evaluate(() => {
            const orders = [];
            
            const tables = document.querySelectorAll('.ant-table');
            console.log(`找到 ${tables.length} 个表格`);
            
            tables.forEach((table, tableIndex) => {
                const rows = table.querySelectorAll('tbody tr');
                console.log(`表格 ${tableIndex} 有 ${rows.length} 行数据`);
                
                rows.forEach((row, rowIndex) => {
                    if (row.classList.contains('ant-table-placeholder')) {
                        return;
                    }
                    
                    const cells = row.querySelectorAll('td');
                    
                    if (cells.length > 0) {
                        try {
                            const order = {
                                id: row.getAttribute('data-row-key') || `order_${tableIndex}_${rowIndex}`,
                                applicant: '',
                                form_type: '',
                                content: '',
                                previous_handler: '',
                                receive_time: '',
                                raw_data: [],
                                extracted_info: {},
                                has_action_button: false,
                                action_button_text: '',
                                action_element_type: 'button'
                            };
                            
                            cells.forEach((cell, cellIndex) => {
                                const cellText = cell.textContent.trim();
                                order.raw_data.push(cellText);
                                
                                switch (cellIndex) {
                                    case 0: // 申请人
                                        const applicantSpan = cell.querySelector('span');
                                        if (applicantSpan) {
                                            order.applicant = applicantSpan.textContent.trim();
                                        } else {
                                            order.applicant = cellText;
                                        }
                                        break;
                                        
                                    case 1: // 表单类型
                                        const formTypeSpan = cell.querySelector('span');
                                        if (formTypeSpan) {
                                            order.form_type = formTypeSpan.textContent.trim();
                                        } else {
                                            order.form_type = cellText;
                                        }
                                        break;
                                        
                                    case 2: // 内容
                                        order.content = cellText;
                                        if (cellText) {
                                            const serialMatch = cellText.match(/流水号[：:]\s*([^\s]+)/);
                                            if (serialMatch) {
                                                order.serial_number = serialMatch[1];
                                                order.extracted_info.流水号 = serialMatch[1];
                                            }
                                            
                                            const lines = cellText.split('\n');
                                            lines.forEach(line => {
                                                const trimmedLine = line.trim();
                                                if (trimmedLine.includes('：') || trimmedLine.includes(':')) {
                                                    const [key, value] = trimmedLine.split(/[：:]/);
                                                    if (key && value) {
                                                        const cleanKey = key.trim();
                                                        const cleanValue = value.trim();
                                                        order.extracted_info[cleanKey] = cleanValue;
                                                        
                                                        if (cleanKey.includes('金额') || cleanKey.includes('价格')) {
                                                            order.amount = cleanValue;
                                                        }
                                                        if (cleanKey.includes('日期') || cleanKey.includes('时间')) {
                                                            order.date = cleanValue;
                                                        }
                                                        if (cleanKey.includes('状态')) {
                                                            order.status = cleanValue;
                                                        }
                                                    }
                                                }
                                            });
                                        }
                                        break;
                                        
                                    case 3: // 上一个处理人
                                        order.previous_handler = cellText;
                                        break;
                                        
                                    case 4: // 接收时间
                                        order.receive_time = cellText;
                                        break;
                                        
                                    case 5: // 操作按钮
                                        let viewDetailButton = cell.querySelector('span[style*="color: rgb(66, 145, 242)"]');
                                        if (viewDetailButton && viewDetailButton.textContent.includes('查看详情')) {
                                            order.has_action_button = true;
                                            order.action_button_text = '查看详情';
                                            order.action_element_type = 'span';
                                            order.action_element = viewDetailButton;
                                        } else {
                                            const buttons = cell.querySelectorAll('button');
                                            const links = cell.querySelectorAll('a');
                                            const spans = cell.querySelectorAll('span');
                                            
                                            let selectedButton = null;
                                            let selectedText = '';
                                            
                                            for (const button of buttons) {
                                                const text = button.textContent.trim();
                                                if (text.includes('查看详情') || text.includes('详情')) {
                                                    selectedButton = button;
                                                    selectedText = text;
                                                    break;
                                                }
                                            }
                                            
                                            if (!selectedButton && buttons.length > 0) {
                                                selectedButton = buttons[0];
                                                selectedText = selectedButton.textContent.trim();
                                            }
                                            
                                            if (!selectedButton && links.length > 0) {
                                                for (const link of links) {
                                                    const text = link.textContent.trim();
                                                    if (text.includes('查看详情') || text.includes('详情')) {
                                                        selectedButton = link;
                                                        selectedText = text;
                                                        break;
                                                    }
                                                }
                                                if (!selectedButton && links.length > 0) {
                                                    selectedButton = links[0];
                                                    selectedText = selectedButton.textContent.trim();
                                                }
                                            }
                                            
                                            if (!selectedButton && spans.length > 0) {
                                                for (const span of spans) {
                                                    const text = span.textContent.trim();
                                                    if (text.includes('查看详情') || text.includes('详情') || 
                                                        text.includes('同意') || text.includes('标记已读')) {
                                                        selectedButton = span;
                                                        selectedText = text;
                                                        break;
                                                    }
                                                }
                                            }
                                            
                                            if (selectedButton) {
                                                order.has_action_button = true;
                                                order.action_button_text = selectedText;
                                                order.action_element_type = selectedButton.tagName.toLowerCase();
                                                order.action_element = selectedButton;
                                            }
                                        }
                                        break;
                                }
                            });
                            
                            order.title = `${order.form_type}_${order.applicant}_${order.serial_number || order.id}`;
                            
                            if (order.applicant) {
                                orders.push(order);
                            }
                            
                        } catch (e) {
                            console.error(`处理第 ${rowIndex} 行时出错:`, e);
                        }
                    }
                });
            });
            
            return orders;
        });
        
        console.log(`成功获取 ${orders.length} 条订单`);
        return orders;

    } catch (error) {
        console.error('获取订单列表失败:', error);
        return [];
    }
}

// 获取订单详情
async function getOrderDetail(page, order, orderIndex) {
    console.log(`正在获取订单详情 (${orderIndex + 1}): ${order.form_type} - ${order.applicant}`);
    
    try {
        flowDetailResponses.clear();
        
        await page.waitForTimeout(5000);
        
        try {
            await page.waitForSelector('.ant-table', { timeout: 20000 });
        } catch (e) {
            console.log('等待表格元素超时，尝试继续执行...');
        }
        
        const orderDetail = await page.evaluate(async (orderData) => {
            let row = document.querySelector(`tr[data-row-key="${orderData.id}"]`);
            
            if (!row) {
                const allRows = document.querySelectorAll('tbody tr');
                for (const tr of allRows) {
                    const rowText = tr.textContent;
                    if (rowText.includes(orderData.serial_number) || 
                        rowText.includes(orderData.applicant) ||
                        rowText.includes(orderData.content.substring(0, 20))) {
                        row = tr;
                        console.log(`通过内容找到订单行: ${orderData.serial_number}`);
                        break;
                    }
                }
            }
            
            if (!row) {
                console.log(`未找到订单ID为 ${orderData.id} 的行`);
                return null;
            }
            
            let actionElement = null;
            
            const viewDetailSelectors = [
                'span[style*="color: rgb(66, 145, 242)"]',
                'button:contains("查看详情")',
                'a:contains("查看详情")',
                'span:contains("查看详情")'
            ];
            
            for (const selector of viewDetailSelectors) {
                try {
                    const elements = row.querySelectorAll(selector);
                    for (const element of elements) {
                        const text = element.textContent.trim();
                        if (text.includes('查看详情') || text.includes('详情')) {
                            actionElement = element;
                            console.log(`找到查看详情按钮: ${text}`);
                            break;
                        }
                    }
                    if (actionElement) break;
                } catch (e) {
                    // 忽略无效的选择器
                }
            }
            
            if (!actionElement) {
                const allButtons = row.querySelectorAll('button, a, span');
                for (const element of allButtons) {
                    const text = element.textContent.trim();
                    if (text.includes('查看详情') || text.includes('详情')) {
                        actionElement = element;
                        console.log(`找到详情按钮: ${text}`);
                        break;
                    } else if (text.includes('同意') || text.includes('标记已读') || text.includes('查看')) {
                        actionElement = element;
                        console.log(`找到操作按钮: ${text}`);
                        break;
                    }
                }
            }
            
            if (!actionElement) {
                const clickableElements = row.querySelectorAll('button, a, [role="button"], [onclick]');
                if (clickableElements.length > 0) {
                    actionElement = clickableElements[0];
                    console.log(`选择第一个可点击元素: ${actionElement.textContent.trim()}`);
                }
            }
            
            if (!actionElement) {
                console.log(`订单 ${orderData.id} 没有可点击的操作元素`);
                return null;
            }
            
            const elementText = actionElement.textContent.trim();
            const isDisabled = actionElement.disabled || actionElement.classList.contains('disabled');
            
            if (isDisabled) {
                console.log(`订单 ${orderData.id} 的操作元素已禁用: ${elementText}`);
                return null;
            }
            
            const isVisible = actionElement.offsetWidth > 0 && actionElement.offsetHeight > 0;
            if (!isVisible) {
                console.log(`订单 ${orderData.id} 的操作元素不可见: ${elementText}`);
                return null;
            }
            
            actionElement.click();
            console.log(`已点击订单 ${orderData.id} 的操作元素: ${elementText}`);
            
            return {
                button_text: elementText,
                row_found: true,
                element_type: actionElement.tagName.toLowerCase()
            };
        }, order);
        
        if (!orderDetail) {
            console.log(`未找到订单 ${order.id} 的可点击操作元素`);
            return order;
        }
        
        console.log('等待详情展开和Flow_Detail请求...');
        
        let retryCount = 0;
        const maxRetries = 5;
        
        while (flowDetailResponses.size === 0 && retryCount < maxRetries) {
            await page.waitForTimeout(10000 + retryCount * 5000);
            retryCount++;
            console.log(`等待Flow_Detail响应 (尝试 ${retryCount}/${maxRetries})...`);
        }
        
        if (flowDetailResponses.size > 0) {
            console.log(`成功捕获到 ${flowDetailResponses.size} 个Flow_Detail响应`);
            
            const latestResponse = Array.from(flowDetailResponses.values()).pop();
            order.flow_detail_data = latestResponse.data;
            order.flow_detail_url = latestResponse.url;
            order.flow_detail_timestamp = latestResponse.timestamp;
            
            console.log(`Flow_Detail数据大小: ${JSON.stringify(latestResponse.data).length} 字符`);
        } else {
            console.log('未捕获到Flow_Detail响应，可能是网络问题或服务器响应慢');
            
            try {
                const closeButton = await page.$('.ant-modal-close');
                if (closeButton) {
                    await closeButton.click();
                    await page.waitForTimeout(2000);
                    console.log('已关闭弹窗');
                } else {
                    await page.keyboard.press('Escape');
                    await page.waitForTimeout(2000);
                    console.log('已按ESC键关闭弹窗');
                }
                
                await page.waitForSelector('.ant-modal-content', { state: 'hidden', timeout: 5000 })
                    .catch(() => console.log('弹窗可能未完全关闭'));
                    
            } catch (e) {
                console.error('关闭弹窗失败:', e.message);
            }
        }
        
        return order;
        
    } catch (error) {
        console.error(`获取订单详情失败: ${error.message}`);
        return order;
    }
}

// 数据处理函数
function processOrders(orders) {
    return orders.map(order => {
        const serialNumber = extractSerialNumber(order);
        
        let formType = order.form_type || '';
        if (!formType && order.raw_data && order.raw_data.length > 1) {
            const secondRow = order.raw_data[1];
            if (secondRow.includes('生产订单')) {
                formType = '生产订单';
            } else if (secondRow.includes('销售单')) {
                formType = '销售单';
            } else if (secondRow.includes('订单')) {
                formType = '订单';
            }
        }
        
        if (formType === '销售单') {
            const contentData = generateSalesOrderContent(order);
            return {
                id: order.id || '',
                applicant: order.applicant || '',
                order_number: contentData.basic_info.order_number || serialNumber,
                form_type: formType,
                receive_time: order.receive_time || '',
                date: contentData.basic_info.date || '',
                department: contentData.basic_info.department || '',
                status: contentData.basic_info.status || '',
                current_step: contentData.basic_info.current_step || '',
                handler: contentData.basic_info.handler || '',
                sales_document_number: contentData.basic_info.sales_document_number || '',
                sales_date: contentData.basic_info.sales_date || '',
                customer: contentData.basic_info.customer || '',
                customer_type: contentData.basic_info.customer_type || '',
                latest_arrival_time: contentData.basic_info.latest_arrival_time || '',
                sales_category: contentData.basic_info.sales_category || '',
                sales_details: contentData.sales_details
            };
        } else {
            const contentData = generateProductionOrderContent(order);
            return {
                id: order.id || '',
                applicant: order.applicant || '',
                order_number: contentData.basic_info.order_number || serialNumber,
                form_type: formType,
                receive_time: order.receive_time || '',
                date: contentData.basic_info.date || '',
                department: contentData.basic_info.department || '',
                status: contentData.basic_info.status || '',
                current_step: contentData.basic_info.current_step || '',
                handler: contentData.basic_info.handler || '',
                sales_type: contentData.basic_info.sales_type || '',
                matching_supplier: contentData.basic_info.matching_supplier || '',
                notes: contentData.basic_info.notes || '',
                order_details: contentData.order_details,
                material_details: contentData.material_details
            };
        }
    });
}

// 提取流水号
function extractSerialNumber(order) {
    if (order.extracted_info && order.extracted_info.流水号) {
        let serialNumber = order.extracted_info.流水号;
        if (serialNumber.includes('入账日期')) {
            serialNumber = serialNumber.split('入账日期')[0];
        }
        return serialNumber;
    }
    
    if (order.content) {
        const serialMatch = order.content.match(/流水号[：:]\s*([^\s]+)/);
        if (serialMatch) {
            let serialNumber = serialMatch[1];
            if (serialNumber.includes('入账日期')) {
                serialNumber = serialNumber.split('入账日期')[0];
            }
            return serialNumber;
        }
    }
    
    if (order.serial_number) {
        let serialNumber = order.serial_number;
        if (serialNumber.includes('入账日期')) {
            serialNumber = serialNumber.split('入账日期')[0];
        }
        return serialNumber;
    }
    
    if (order.flow_detail_data?.data?.data?.sn) {
        return order.flow_detail_data.data.data.sn;
    }
    
    return '';
}

// 生成销售单内容
function generateSalesOrderContent(order) {
    let basicInfo = {};
    let salesDetails = '';
    
    if (order.flow_detail_data?.data?.data) {
        const flowData = order.flow_detail_data.data.data;
        
        if (flowData.sn) basicInfo.order_number = flowData.sn;
        if (flowData.date) basicInfo.date = flowData.date;
        if (flowData.departmentname) basicInfo.department = flowData.departmentname;
        if (flowData.status_cn) basicInfo.status = flowData.status_cn;
        if (flowData.flowstep) basicInfo.current_step = flowData.flowstep;
        if (flowData.flowuser) basicInfo.handler = flowData.flowuser;
        
        if (flowData['1863a43f386aac30']) basicInfo.sales_document_number = flowData['1863a43f386aac30'];
        if (flowData['18633dad9bae18b1']) basicInfo.sales_date = flowData['18633dad9bae18b1'];
        if (flowData['186733833bcb1d93']) {
            const customer = flowData['186733833bcb1d93'];
            if (typeof customer === 'object' && customer.value) {
                basicInfo.customer = customer.value.sn || '';
                if (customer.value['18633ef3f59dad1d']) {
                    basicInfo.customer_type = customer.value['18633ef3f59dad1d'];
                }
            } else {
                basicInfo.customer = customer;
            }
        }
        if (flowData['1863b457aef61689']) basicInfo.latest_arrival_time = flowData['1863b457aef61689'];
        if (flowData['18695bb09265efba']) basicInfo.sales_category = flowData['18695bb09265efba'];
        
        const salesItems = flowData['18633f513e89c426'] || [];
        if (salesItems.length > 0) {
            salesDetails = '销售明细:\n';
            salesItems.forEach((item, index) => {
                const style = item['18633f63e5a9cc80'] || '';
                const color = item['18633f6d95e3f31b'] || '';
                const size = item['18633f6f3a8a9f37'] || '';
                const quantity = item['18633f70a579634a'] || 0;
                salesDetails += `${index + 1}. 款号: ${style}, 颜色: ${color}, 尺码: ${size}, 数量: ${quantity}件\n`;
            });
        }
    }
    
    return {
        basic_info: basicInfo,
        sales_details: salesDetails.trim()
    };
}

// 生成生产订单内容
function generateProductionOrderContent(order) {
    let basicInfo = {};
    let orderDetails = '';
    let materialDetails = '';
    
    if (order.flow_detail_data?.data?.data) {
        const flowData = order.flow_detail_data.data.data;
        
        if (flowData.sn) basicInfo.order_number = flowData.sn;
        if (flowData.date) basicInfo.date = flowData.date;
        if (flowData.departmentname) basicInfo.department = flowData.departmentname;
        if (flowData.status_cn) basicInfo.status = flowData.status_cn;
        if (flowData.flowstep) basicInfo.current_step = flowData.flowstep;
        if (flowData.flowuser) basicInfo.handler = flowData.flowuser;
        if (flowData['18695c1f1dd38ad2']) basicInfo.sales_type = flowData['18695c1f1dd38ad2'];
        if (flowData['18630555812bbb91']) basicInfo.matching_supplier = flowData['18630555812bbb91'];
        if (flowData['186e039af74dabfd']) basicInfo.notes = flowData['186e039af74dabfd'];
        
        const orderItems = flowData['186270de9f66ee7f'] || [];
        if (orderItems.length > 0) {
            orderDetails = '订单明细:\n';
            orderItems.forEach((item, index) => {
                const style = item['186270e2cedcd674'] || '';
                const color = item['186270e5d684af51'] || '';
                const size = item['186270e67e5745c3'] || '';
                const quantity = item['186270e9a0ed28fb'] || 0;
                orderDetails += `${index + 1}. 款号: ${style}, 颜色: ${color}, 尺码: ${size}, 数量: ${quantity}件\n`;
            });
        }
        
        const materials = flowData['186270f21079ca34'] || [];
        if (materials.length > 0) {
            materialDetails += '所需物料:\n';
            materials.forEach((material, index) => {
                const materialName = material['186270ffdcda0671'] || '';
                const materialCode = material['1878cfb5936ad86a'] || '';
                const color = material['186271094f55ba9e'] || '';
                const size = material['186356a08f6d4654'] || '';
                const requiredQuantity = material['1862711aa5d951f3'] || 0;
                const lossRatio = material['1869700df1f0506d'] || 0;
                const unitUsage = material['1864ee4957ee6750'] || 0;
                const estimatedPurchaseQuantity = material['1862712798d2c93f'] || 0;
                const unit = material['186271406b77bc90'] || '';
                const unitPrice = material['186b0984ddccb90b'] || 0;
                const amount = material['186b09887da0f0d0'] || 0;
                const occupiedQuantity = material['1862efec2f91d150'] || 0;
                const remarks = material['186a646a90fd271c'] || '';
                
                materialDetails += `${index + 1}. 物料名称: ${materialName}, 物料编码: ${materialCode}, 颜色: ${color}, 尺码: ${size}, 所需数量: ${requiredQuantity}, 损耗比例: ${lossRatio}, 单件用量: ${unitUsage}, 预计采购数量: ${estimatedPurchaseQuantity}, 单位: ${unit}, 单价: ${unitPrice}, 金额: ${amount}, 占用数量: ${occupiedQuantity}, 备注: ${remarks}\n`;
            });
        }
    }
    
    return {
        basic_info: basicInfo,
        order_details: orderDetails.trim(),
        material_details: materialDetails.trim()
    };
}

// 分离订单类型
function separateOrders(processedOrders) {
    const productionOrders = [];
    const salesOrders = [];
    
    processedOrders.forEach(order => {
        if (order.form_type === '生产订单') {
            productionOrders.push(order);
        } else if (order.form_type === '销售单') {
            salesOrders.push(order);
        } else {
            if (order.order_details && order.material_details) {
                productionOrders.push(order);
            } else {
                salesOrders.push(order);
            }
        }
    });
    
    return {
        productionOrders,
        salesOrders
    };
}

// 解析销售明细
function parseSalesDetails(salesDetailsText, orderInfo) {
    if (!salesDetailsText || typeof salesDetailsText !== 'string') {
        return [];
    }

    const salesItems = [];
    const lines = salesDetailsText.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (!line || line.includes('销售明细:')) {
            continue;
        }

        const match = line.match(/^(\d+)\.\s*款号:\s*([^,]+),\s*颜色:\s*([^,]+),\s*尺码:\s*([^,]+),\s*数量:\s*(\d+)件/);

        if (match) {
            const [, itemNumber, styleNumber, color, size, quantity] = match;

            salesItems.push({
                order_id: orderInfo.id,
                order_applicant: orderInfo.applicant,
                order_form_type: orderInfo.form_type,
                item_number: parseInt(itemNumber),
                style_number: styleNumber.trim(),
                color: color.trim(),
                size: size.trim(),
                quantity: parseInt(quantity),
                unit_price: null,
                amount: null
            });
        }
    }

    return salesItems;
}

// 解析物料明细
function parseMaterialDetails(materialDetailsText, orderInfo) {
    if (!materialDetailsText || typeof materialDetailsText !== 'string') {
        return [];
    }

    const materials = [];
    const lines = materialDetailsText.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (!line || line.includes('所需物料:')) {
            continue;
        }

        const match = line.match(/^(\d+)\.\s*物料名称:\s*([^,]+),\s*物料编码:\s*([^,]+),\s*颜色:\s*([^,]*),\s*尺码:\s*([^,]*),\s*所需数量:\s*([^,]+),\s*损耗比例:\s*([^,]+),\s*单件用量:\s*([^,]+),\s*预计采购数量:\s*([^,]+),\s*单位:\s*([^,]+),\s*单价:\s*([^,]+),\s*金额:\s*([^,]+),\s*占用数量:\s*([^,]+),\s*备注:\s*(.*)/);

        if (match) {
            const [, itemNumber, materialName, materialCode, color, size, requiredQuantity, lossRatio, unitUsage, plannedQuantity, unit, unitPrice, amount, occupiedQuantity, notes] = match;

            materials.push({
                order_id: orderInfo.id,
                order_applicant: orderInfo.applicant,
                order_form_type: orderInfo.form_type,
                item_number: parseInt(itemNumber),
                material_name: materialName.trim(),
                material_code: materialCode.trim(),
                color: color.trim(),
                size: size.trim(),
                required_quantity: parseFloat(requiredQuantity) || 0,
                loss_ratio: parseFloat(lossRatio) || 0,
                unit_usage: parseFloat(unitUsage) || 0,
                planned_quantity: parseFloat(plannedQuantity) || 0,
                unit: unit.trim(),
                unit_price: parseFloat(unitPrice) || 0,
                amount: parseFloat(amount) || 0,
                occupied_quantity: parseFloat(occupiedQuantity) || 0,
                notes: notes.trim()
            });
        }
    }

    return materials;
}

// 创建数据摘要
function createDataSummary(salesOrders, productionOrders, salesDetails, materialDetails) {
    const summary = {
        salesOrders: {
            total: salesOrders ? salesOrders.length : 0,
            byStatus: {},
            byApplicant: {}
        },
        productionOrders: {
            total: productionOrders ? productionOrders.length : 0,
            byStatus: {},
            byApplicant: {}
        },
        salesDetails: {
            total: salesDetails ? salesDetails.length : 0,
            byStyleNumber: {}
        },
        materialDetails: {
            total: materialDetails ? materialDetails.length : 0,
            byMaterialName: {}
        },
        dateRange: {
            earliest: null,
            latest: null
        }
    };

    if (salesOrders) {
        salesOrders.forEach(order => {
            summary.salesOrders.byStatus[order.status] = (summary.salesOrders.byStatus[order.status] || 0) + 1;
            summary.salesOrders.byApplicant[order.applicant] = (summary.salesOrders.byApplicant[order.applicant] || 0) + 1;

            if (order.date) {
                const orderDate = new Date(order.date);
                if (!summary.dateRange.earliest || orderDate < new Date(summary.dateRange.earliest)) {
                    summary.dateRange.earliest = order.date;
                }
                if (!summary.dateRange.latest || orderDate > new Date(summary.dateRange.latest)) {
                    summary.dateRange.latest = order.date;
                }
            }
        });
    }

    if (productionOrders) {
        productionOrders.forEach(order => {
            summary.productionOrders.byStatus[order.status] = (summary.productionOrders.byStatus[order.status] || 0) + 1;
            summary.productionOrders.byApplicant[order.applicant] = (summary.productionOrders.byApplicant[order.applicant] || 0) + 1;

            if (order.date) {
                const orderDate = new Date(order.date);
                if (!summary.dateRange.earliest || orderDate < new Date(summary.dateRange.earliest)) {
                    summary.dateRange.earliest = order.date;
                }
                if (!summary.dateRange.latest || orderDate > new Date(summary.dateRange.latest)) {
                    summary.dateRange.latest = order.date;
                }
            }
        });
    }

    if (salesDetails) {
        salesDetails.forEach(item => {
            summary.salesDetails.byStyleNumber[item.style_number] = (summary.salesDetails.byStyleNumber[item.style_number] || 0) + item.quantity;
        });
    }

    if (materialDetails) {
        materialDetails.forEach(item => {
            summary.materialDetails.byMaterialName[item.material_name] = (summary.materialDetails.byMaterialName[item.material_name] || 0) + item.required_quantity;
        });
    }

    return summary;
}

// 上传数据到N8N
async function uploadToN8N(allData, summary) {
    try {
        console.log('📤 上传数据到N8N...');
        
        const payload = {
            salesOrders: allData.salesOrders || [],
            productionOrders: allData.productionOrders || [],
            salesDetails: allData.salesDetails || [],
            materialDetails: allData.materialDetails || [],
            summary: summary,
            metadata: {
                uploadTime: new Date().toISOString(),
                dataType: 'all_data',
                version: '2.0',
                counts: {
                    salesOrders: allData.salesOrders ? allData.salesOrders.length : 0,
                    productionOrders: allData.productionOrders ? allData.productionOrders.length : 0,
                    salesDetails: allData.salesDetails ? allData.salesDetails.length : 0,
                    materialDetails: allData.materialDetails ? allData.materialDetails.length : 0
                }
            }
        };

        console.log(`📊 数据统计:`);
        console.log(`  - 销售订单: ${payload.metadata.counts.salesOrders} 个`);
        console.log(`  - 生产订单: ${payload.metadata.counts.productionOrders} 个`);
        console.log(`  - 销售明细: ${payload.metadata.counts.salesDetails} 个`);
        console.log(`  - 物料明细: ${payload.metadata.counts.materialDetails} 个`);

        const response = await fetch(N8N_CONFIG.webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            const result = await response.json();
            console.log('✅ 数据上传成功:', result);
            return result;
        } else {
            throw new Error(`上传失败: ${response.statusText}`);
        }
    } catch (error) {
        console.error('❌ 数据上传失败:', error);
        throw error;
    }
}

// 主函数
async function main() {
    const options = parseArgs();
    const { page: targetPage, headless, orderCount, skip, sinceId, upload } = options;
    
    console.log(`开始爬取第 ${targetPage} 页数据...`);
    console.log(`配置: 无头模式=${headless}, 订单限制=${orderCount || '无限制'}, 跳过前 ${skip} 条, 上次同步ID: ${sinceId || '无'}, 上传=${upload}`);
    
    const browser = await chromium.launch({
        headless: headless
    });
    
    try {
        const context = await browser.newContext({ 
            navigationTimeout: 60000, 
            acceptDownloads: true 
        });
        const page = await context.newPage();
        
        await setupNetworkListener(page);
        
        // 登录
        const loginSuccess = await login(page);
        if (!loginSuccess) {
            console.log('登录失败，程序退出');
            return;
        }

        // 导航到订单列表页面
        await page.goto('https://outsofts.net/upcoming?status=3', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        await page.waitForTimeout(10000);

        // 导航到目标页面
        const navigationSuccess = await navigateToSpecificPage(page, targetPage);
        if (!navigationSuccess) {
            console.log(`无法导航到第 ${targetPage} 页，程序退出`);
            return;
        }

        // 获取当前页面的订单列表
        const orders = await getOrderListFromCurrentPage(page);
        
        if (orders.length === 0) {
            console.log('当前页面未找到任何订单');
            return;
        }

        console.log(`找到 ${orders.length} 条订单，开始获取详情...`);
        
        const ordersWithButtons = orders.filter(order => order.has_action_button);
        const ordersWithoutButtons = orders.filter(order => !order.has_action_button);
        
        console.log(`有操作元素的订单: ${ordersWithButtons.length} 条`);
        console.log(`没有操作元素的订单: ${ordersWithoutButtons.length} 条`);
        
        // 统计不同操作按钮的类型
        const buttonTypes = {};
        ordersWithButtons.forEach(order => {
            const buttonText = order.action_button_text;
            buttonTypes[buttonText] = (buttonTypes[buttonText] || 0) + 1;
        });
        
        console.log('操作按钮类型统计:');
        Object.entries(buttonTypes).forEach(([text, count]) => {
            console.log(`  - "${text}": ${count} 个`);
        });
        
        // 确定要处理的订单数量
        const maxOrders = orderCount > 0 ? Math.min(orderCount, orders.length - skip) : (orders.length - skip);
        let ordersToProcess = [];
        for (let idx = skip; idx < skip + maxOrders && idx < orders.length; idx++) {
            const order = orders[idx];
            if (sinceId && order.id === sinceId) {
                console.log(`遇到 last_id: ${sinceId}，停止收集新订单。`);
                break;
            }
            ordersToProcess.push(order);
        }
        console.log(`将跳过前 ${skip} 条，处理 ${ordersToProcess.length} 个新订单（遇到 last_id 即停止，原请求: ${orderCount}, 可用: ${orders.length}）`);
        
        const failedOrders = [];
        
        for (let i = 0; i < ordersToProcess.length; i++) {
            try {
                let order = ordersToProcess[i];
                console.log(`处理第 ${i + 1}/${ordersToProcess.length} 个订单`);

                // 检查是否"标记已读"按钮
                if (order.has_action_button && order.action_button_text && order.action_button_text.includes('标记已读')) {
                    console.log(`订单 ${order.id} 是"标记已读"按钮，自动点击并刷新页面...`);
                    await page.evaluate((orderId) => {
                        const row = document.querySelector(`tr[data-row-key="${orderId}"]`);
                        if (row) {
                            const spans = row.querySelectorAll('span');
                            for (const span of spans) {
                                if (span.textContent.includes('标记已读')) {
                                    span.click();
                                    break;
                                }
                            }
                        }
                    }, order.id);
                    await page.waitForTimeout(4000);
                    const refreshedOrders = await getOrderListFromCurrentPage(page);
                    let refreshedOrder = null;
                    if (order.serial_number) {
                        refreshedOrder = refreshedOrders.find(o => o.serial_number === order.serial_number);
                    }
                    if (!refreshedOrder) {
                        refreshedOrder = refreshedOrders.find(o => o.id === order.id);
                    }
                    if (refreshedOrder && refreshedOrder.has_action_button && refreshedOrder.action_button_text && refreshedOrder.action_button_text.includes('查看详情')) {
                        console.log(`订单 ${order.id} 已变为"查看详情"，继续抓详情...`);
                        const detailedOrder = await getOrderDetail(page, refreshedOrder, i);
                        ordersToProcess[i] = detailedOrder;
                        if (!detailedOrder.flow_detail_data && !detailedOrder.detail) {
                            failedOrders.push({
                                index: i + 1,
                                id: order.id,
                                serial_number: order.serial_number,
                                applicant: order.applicant,
                                reason: '详情获取失败'
                            });
                        }
                    } else {
                        console.log(`订单 ${order.id} 刷新后仍无"查看详情"，只保留基础信息`);
                        order.no_detail = true;
                        ordersToProcess[i] = order;
                    }
                    continue;
                }
                
                // 没有任何操作按钮
                if (!order.has_action_button) {
                    order.no_detail = true;
                    failedOrders.push({
                        index: i + 1,
                        id: order.id,
                        serial_number: order.serial_number,
                        applicant: order.applicant,
                        reason: '没有操作按钮'
                    });
                    ordersToProcess[i] = order;
                    continue;
                }
                
                // 正常"查看详情"流程
                const detailedOrder = await getOrderDetail(page, order, i);
                ordersToProcess[i] = detailedOrder;
                if (!detailedOrder.flow_detail_data && !detailedOrder.detail) {
                    failedOrders.push({
                        index: i + 1,
                        id: order.id,
                        serial_number: order.serial_number,
                        applicant: order.applicant,
                        reason: '详情获取失败'
                    });
                }
                
                // 根据是否成功获取详情调整等待时间
                const waitTime = flowDetailResponses.size > 0 ? 
                    CRAWL_CONFIG.delayBetweenOrders : 
                    CRAWL_CONFIG.delayBetweenOrders * 2;
                await page.waitForTimeout(waitTime);
            } catch (error) {
                console.error(`处理第 ${i + 1} 个订单时出错: ${error.message}`);
                continue;
            }
        }
        
        console.log('✅ 爬虫执行完成，开始数据处理...');
        
        // 处理订单数据
        const processedOrders = processOrders(ordersToProcess);
        const { productionOrders, salesOrders } = separateOrders(processedOrders);
        
        console.log(`✅ 数据处理完成:`);
        console.log(`  - 销售订单: ${salesOrders.length} 个`);
        console.log(`  - 生产订单: ${productionOrders.length} 个`);
        
        // 解析销售明细和物料明细
        const allSalesDetails = [];
        const allMaterialDetails = [];
        
        // 从销售订单中解析销售明细
        salesOrders.forEach(order => {
            if (order.sales_details) {
                const orderInfo = {
                    id: order.id,
                    applicant: order.applicant,
                    form_type: order.form_type
                };
                const salesDetails = parseSalesDetails(order.sales_details, orderInfo);
                allSalesDetails.push(...salesDetails);
            }
        });
        
        // 从生产订单中解析物料明细
        productionOrders.forEach(order => {
            if (order.material_details) {
                const orderInfo = {
                    id: order.id,
                    applicant: order.applicant,
                    form_type: order.form_type
                };
                const materialDetails = parseMaterialDetails(order.material_details, orderInfo);
                allMaterialDetails.push(...materialDetails);
            }
        });
        
        console.log(`✅ 明细解析完成:`);
        console.log(`  - 销售明细: ${allSalesDetails.length} 个`);
        console.log(`  - 物料明细: ${allMaterialDetails.length} 个`);
        
        // 准备所有数据
        const allData = {
            salesOrders: salesOrders,
            productionOrders: productionOrders,
            salesDetails: allSalesDetails,
            materialDetails: allMaterialDetails
        };
        
        // 创建数据摘要
        const summary = createDataSummary(salesOrders, productionOrders, allSalesDetails, allMaterialDetails);
        
        // 直接输出JSON格式的订单数据
        console.log('\n📊 订单数据 (JSON格式):');
        console.log(JSON.stringify(allData, null, 2));
        
        // 同时输出到文件，方便查看完整结构
        const outputFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'output', `orders_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        await fs.mkdir(path.dirname(outputFile), { recursive: true });
        await fs.writeFile(outputFile, JSON.stringify(allData, null, 2), 'utf8');
        console.log(`📁 数据已保存到: ${outputFile}`);
        
        // 输出数据摘要
        console.log('\n📈 数据摘要:');
        console.log(`销售订单: ${summary.salesOrders.total} 个`);
        console.log(`生产订单: ${summary.productionOrders.total} 个`);
        console.log(`销售明细: ${summary.salesDetails.total} 个`);
        console.log(`物料明细: ${summary.materialDetails.total} 个`);
        
        if (summary.dateRange.earliest && summary.dateRange.latest) {
            console.log(`日期范围: ${summary.dateRange.earliest} 至 ${summary.dateRange.latest}`);
        }
        
        // 总结失败的订单
        if (failedOrders.length > 0) {
            console.log('\n❌ 未成功爬取详情的订单:');
            failedOrders.forEach(failed => {
                console.log(`  ${failed.index}. ID: ${failed.id || 'N/A'}, 流水号: ${failed.serial_number || 'N/A'}, 申请人: ${failed.applicant || 'N/A'}, 原因: ${failed.reason}`);
            });
        } else {
            console.log('\n✅ 所有订单详情均已成功获取');
        }
        
        console.log('\n🎉 程序执行完成！');
        
    } catch (error) {
        console.error('程序执行失败:', error);
    } finally {
        await browser.close();
    }
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith('main.js')) {
    main().catch(console.error);
}
        