const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const methodOverride = require('method-override');
const session = require('express-session');
const flash = require('connect-flash');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;

// Data storage - using JSON file
const dataPath = path.join(__dirname, 'data', 'transactions.json');

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'));
}

// Initialize transactions file if it doesn't exist
if (!fs.existsSync(dataPath)) {
    fs.writeFileSync(dataPath, JSON.stringify([]));
}

// Helper Functions
const readTransactions = () => {
    const data = fs.readFileSync(dataPath);
    return JSON.parse(data);
};

const writeTransactions = (transactions) => {
    fs.writeFileSync(dataPath, JSON.stringify(transactions, null, 2));
};

const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount);
};

const getMonthName = (monthNumber) => {
    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return months[monthNumber];
};

// Middleware
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(methodOverride('_method'));
app.use(session({
    secret: 'expense-tracker-secret',
    resave: true,
    saveUninitialized: true
}));
app.use(flash());

// Global variables
app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    next();
});

// Routes
app.get('/', (req, res) => {
    try {
        const transactions = readTransactions();
        
        // Calculate totals
        let totalIncome = 0;
        let totalExpense = 0;
        
        transactions.forEach(transaction => {
            if (transaction.type === 'income') {
                totalIncome += parseFloat(transaction.amount);
            } else {
                totalExpense += parseFloat(transaction.amount);
            }
        });
        
        const balance = totalIncome - totalExpense;
        
        res.render('index', {
            transactions,
            totalIncome: formatCurrency(totalIncome),
            totalExpense: formatCurrency(totalExpense),
            balance: formatCurrency(balance)
        });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Error loading transactions');
        res.render('index', { transactions: [], totalIncome: '$0.00', totalExpense: '$0.00', balance: '$0.00' });
    }
});

// Add new transaction
app.post('/transactions', (req, res) => {
    try {
        const { title, amount, type, category, description } = req.body;
        const transactions = readTransactions();
        
        const newTransaction = {
            id: Date.now().toString(),
            title,
            amount: parseFloat(amount),
            type,
            category,
            date: new Date().toISOString(),
            description
        };
        
        transactions.unshift(newTransaction); // Add to beginning of array for chronological display
        writeTransactions(transactions);
        
        req.flash('success_msg', 'Transaction added successfully');
        res.redirect('/');
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Error adding transaction');
        res.redirect('/');
    }
});

// Delete transaction
app.delete('/transactions/:id', (req, res) => {
    try {
        const { id } = req.params;
        let transactions = readTransactions();
        
        transactions = transactions.filter(transaction => transaction.id !== id);
        writeTransactions(transactions);
        
        req.flash('success_msg', 'Transaction deleted successfully');
        res.redirect('/');
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Error deleting transaction');
        res.redirect('/');
    }
});

// Edit transaction form
app.get('/transactions/edit/:id', (req, res) => {
    try {
        const { id } = req.params;
        const transactions = readTransactions();
        const transaction = transactions.find(t => t.id === id);
        
        if (!transaction) {
            req.flash('error_msg', 'Transaction not found');
            return res.redirect('/');
        }
        
        res.render('edit', { transaction });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Error loading transaction');
        res.redirect('/');
    }
});

// Update transaction
app.put('/transactions/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { title, amount, type, category, description } = req.body;
        let transactions = readTransactions();
        
        const index = transactions.findIndex(t => t.id === id);
        
        if (index === -1) {
            req.flash('error_msg', 'Transaction not found');
            return res.redirect('/');
        }
        
        transactions[index] = {
            ...transactions[index],
            title,
            amount: parseFloat(amount),
            type,
            category,
            description,
            updatedAt: new Date().toISOString()
        };
        
        writeTransactions(transactions);
        
        req.flash('success_msg', 'Transaction updated successfully');
        res.redirect('/');
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Error updating transaction');
        res.redirect('/');
    }
});

// Monthly report
app.get('/reports', (req, res) => {
    try {
        const transactions = readTransactions();
        
        // Get unique years and months from transactions
        const dates = new Set();
        const yearMonths = [];
        
        transactions.forEach(transaction => {
            const date = new Date(transaction.date);
            const yearMonth = `${date.getFullYear()}-${date.getMonth()}`;
            
            if (!dates.has(yearMonth)) {
                dates.add(yearMonth);
                yearMonths.push({
                    year: date.getFullYear(),
                    month: date.getMonth(),
                    label: `${getMonthName(date.getMonth())} ${date.getFullYear()}`
                });
            }
        });
        
        // Sort by year and month, newest first
        yearMonths.sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year;
            return b.month - a.month;
        });
        
        res.render('reports', { yearMonths });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Error loading reports');
        res.redirect('/');
    }
});

// Generate PDF report
app.get('/reports/download/:year/:month', (req, res) => {
    try {
        const year = parseInt(req.params.year);
        const month = parseInt(req.params.month);
        const transactions = readTransactions();
        
        // Filter transactions for the specified month and year
        const filteredTransactions = transactions.filter(transaction => {
            const date = new Date(transaction.date);
            return date.getFullYear() === year && date.getMonth() === month;
        });
        
        // Calculate totals
        let totalIncome = 0;
        let totalExpense = 0;
        
        filteredTransactions.forEach(transaction => {
            if (transaction.type === 'income') {
                totalIncome += parseFloat(transaction.amount);
            } else {
                totalExpense += parseFloat(transaction.amount);
            }
        });
        
        const balance = totalIncome - totalExpense;
        
        // Group transactions by category
        const categories = {};
        
        filteredTransactions.forEach(transaction => {
            if (!categories[transaction.category]) {
                categories[transaction.category] = {
                    income: 0,
                    expense: 0
                };
            }
            
            if (transaction.type === 'income') {
                categories[transaction.category].income += parseFloat(transaction.amount);
            } else {
                categories[transaction.category].expense += parseFloat(transaction.amount);
            }
        });
        
        // Create PDF
        const doc = new PDFDocument({ margin: 50 });
        
        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=expense-report-${year}-${month+1}.pdf`);
        
        // Pipe PDF to response
        doc.pipe(res);
        
        // Title
        doc.fontSize(25).text(`Financial Report - ${getMonthName(month)} ${year}`, { align: 'center' });
        doc.moveDown();
        
        // Summary
        doc.fontSize(14).text('Summary', { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(12).text(`Total Income: ${formatCurrency(totalIncome)}`);
        doc.fontSize(12).text(`Total Expenses: ${formatCurrency(totalExpense)}`);
        doc.fontSize(12).text(`Balance: ${formatCurrency(balance)}`, { bold: balance >= 0 });
        doc.moveDown();
        
        // By Category
        doc.fontSize(14).text('Breakdown by Category', { underline: true });
        doc.moveDown(0.5);
        
        Object.keys(categories).forEach(category => {
            doc.fontSize(12).text(`${category}:`);
            doc.fontSize(10).text(`  Income: ${formatCurrency(categories[category].income)}`);
            doc.fontSize(10).text(`  Expenses: ${formatCurrency(categories[category].expense)}`);
            doc.fontSize(10).text(`  Net: ${formatCurrency(categories[category].income - categories[category].expense)}`);
            doc.moveDown(0.5);
        });
        
        doc.moveDown();
        
        // Transactions Table
        doc.fontSize(14).text('Transactions', { underline: true });
        doc.moveDown(0.5);
        
        // Table header
        const tableTop = doc.y;
        const tableLeft = 50;
        const colWidth = (doc.page.width - 100) / 4;
        
        doc.fontSize(10);
        doc.text('Date', tableLeft, tableTop);
        doc.text('Title', tableLeft + colWidth, tableTop);
        doc.text('Category', tableLeft + colWidth * 2, tableTop);
        doc.text('Amount', tableLeft + colWidth * 3, tableTop, { align: 'right' });
        
        doc.moveDown();
        
        // Table rows
        let rowTop = doc.y;
        
        filteredTransactions.forEach((transaction, i) => {
            const date = new Date(transaction.date);
            const formattedDate = `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
            
            // Check if we need a new page
            if (rowTop > doc.page.height - 100) {
                doc.addPage();
                rowTop = 50;
            }
            
            doc.text(formattedDate, tableLeft, rowTop);
            doc.text(transaction.title, tableLeft + colWidth, rowTop);
            doc.text(transaction.category, tableLeft + colWidth * 2, rowTop);
            
            const formattedAmount = transaction.type === 'income' 
                ? `+${formatCurrency(transaction.amount)}` 
                : `-${formatCurrency(transaction.amount)}`;
            
            doc.fillColor(transaction.type === 'income' ? 'green' : 'red')
                .text(formattedAmount, tableLeft + colWidth * 3, rowTop, { align: 'right' })
                .fillColor('black');
            
            rowTop = doc.y + 10;
            doc.moveDown();
        });
        
        // Footer
        doc.fontSize(10).text(`Generated on ${new Date().toLocaleDateString()}`, { align: 'center' });
        
        // Finalize PDF
        doc.end();
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Error generating report');
        res.redirect('/reports');
    }
});

// Monthly data for chart (AJAX endpoint)
app.get('/api/monthly-data/:year/:month', (req, res) => {
    try {
        const year = parseInt(req.params.year);
        const month = parseInt(req.params.month);
        const transactions = readTransactions();
        
        // Filter transactions for the specified month and year
        const filteredTransactions = transactions.filter(transaction => {
            const date = new Date(transaction.date);
            return date.getFullYear() === year && date.getMonth() === month;
        });
        
        // Group by category
        const categories = {};
        
        filteredTransactions.forEach(transaction => {
            if (!categories[transaction.category]) {
                categories[transaction.category] = {
                    income: 0,
                    expense: 0
                };
            }
            
            if (transaction.type === 'income') {
                categories[transaction.category].income += parseFloat(transaction.amount);
            } else {
                categories[transaction.category].expense += parseFloat(transaction.amount);
            }
        });
        
        res.json({
            categories,
            transactions: filteredTransactions
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error fetching monthly data' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});