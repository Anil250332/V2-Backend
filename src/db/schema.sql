-- V2Online Portal MySQL Database Schema Initialization

-- 1. Users Table (Multi-role RBAC)
CREATE TABLE IF NOT EXISTS users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    uuid VARCHAR(36) UNIQUE NOT NULL,
    role ENUM('super_admin', 'sub_admin', 'manager', 'distributor', 'operator', 'agent') NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    mobile VARCHAR(15) UNIQUE NOT NULL,
    email VARCHAR(100) NULL,
    password_hash VARCHAR(255) NOT NULL,
    shop_name VARCHAR(150) NULL,
    aadhaar_number VARCHAR(16) NULL,
    district VARCHAR(100) NULL,
    tehsil VARCHAR(100) NULL,
    ward_no VARCHAR(50) NULL,
    address TEXT NULL,
    distributor_id BIGINT NULL,
    approval_status ENUM('pending', 'approved', 'rejected') DEFAULT 'approved',
    is_active BOOLEAN DEFAULT TRUE,
    is_online BOOLEAN DEFAULT FALSE,
    last_login_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (distributor_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user_role (role),
    INDEX idx_user_mobile (mobile)
);

-- 2. Service Categories
CREATE TABLE IF NOT EXISTS service_categories (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    icon VARCHAR(100) NULL,
    display_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Services
CREATE TABLE IF NOT EXISTS services (
    id INT PRIMARY KEY AUTO_INCREMENT,
    category_id INT NOT NULL,
    name VARCHAR(150) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    description TEXT NULL,
    display_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES service_categories(id) ON DELETE CASCADE
);

-- 4. Sub-Services & Dynamic Form Configurations
CREATE TABLE IF NOT EXISTS sub_services (
    id INT PRIMARY KEY AUTO_INCREMENT,
    service_id INT NOT NULL,
    name VARCHAR(150) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    agent_fee DECIMAL(10,2) NOT NULL,
    operator_share DECIMAL(10,2) NOT NULL,
    distributor_share DECIMAL(10,2) DEFAULT 0.00,
    admin_profit DECIMAL(10,2) NOT NULL,
    form_schema JSON NOT NULL,
    required_docs JSON NOT NULL,
    output_type ENUM('file', 'text', 'both', 'status_only') DEFAULT 'file',
    output_schema JSON NULL,
    estimated_tat_hours INT DEFAULT 4,
    is_active BOOLEAN DEFAULT TRUE,
    created_by BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- 5. Operator to Service & Area Mapping
CREATE TABLE IF NOT EXISTS operator_assignments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    operator_id BIGINT NOT NULL,
    sub_service_id INT NOT NULL,
    district VARCHAR(100) NOT NULL,
    tehsil VARCHAR(100) NULL,
    ward_no VARCHAR(50) NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (operator_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (sub_service_id) REFERENCES sub_services(id) ON DELETE CASCADE,
    UNIQUE KEY uq_operator_area (operator_id, sub_service_id, district, tehsil, ward_no)
);

-- 6. Applications / Service Requests
CREATE TABLE IF NOT EXISTS applications (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    application_no VARCHAR(30) UNIQUE NOT NULL,
    agent_id BIGINT NOT NULL,
    sub_service_id INT NOT NULL,
    operator_id BIGINT NULL,
    distributor_id BIGINT NULL,
    customer_name VARCHAR(100) NOT NULL,
    customer_mobile VARCHAR(15) NOT NULL,
    district VARCHAR(100) NOT NULL,
    tehsil VARCHAR(100) NULL,
    ward_no VARCHAR(50) NULL,
    form_data JSON NOT NULL,
    status ENUM('pending', 'assigned', 'processing', 'correction_required', 'completed', 'verified', 'rejected') DEFAULT 'pending',
    rejection_reason TEXT NULL,
    correction_remarks TEXT NULL,
    govt_ack_no VARCHAR(100) NULL,
    completion_output_data JSON NULL,
    fee_deducted DECIMAL(10,2) NOT NULL,
    operator_payout DECIMAL(10,2) NOT NULL,
    distributor_payout DECIMAL(10,2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (agent_id) REFERENCES users(id),
    FOREIGN KEY (sub_service_id) REFERENCES sub_services(id),
    FOREIGN KEY (operator_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (distributor_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_app_status (status),
    INDEX idx_app_created (created_at)
);

-- 7. Application Uploaded Documents
CREATE TABLE IF NOT EXISTS application_documents (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    application_id BIGINT NOT NULL,
    doc_label VARCHAR(100) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    mime_type VARCHAR(50) NOT NULL,
    file_size_kb INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);

-- 8. User Wallets
CREATE TABLE IF NOT EXISTS wallets (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT UNIQUE NOT NULL,
    balance DECIMAL(12,2) DEFAULT 0.00,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 9. Monetary Transactions Ledger
CREATE TABLE IF NOT EXISTS transactions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    txn_no VARCHAR(40) UNIQUE NOT NULL,
    wallet_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    application_id BIGINT NULL,
    type ENUM('credit', 'debit') NOT NULL,
    category ENUM('topup', 'service_fee', 'operator_earning', 'distributor_commission', 'refund', 'withdrawal', 'admin_adjustment') NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    opening_balance DECIMAL(12,2) NOT NULL,
    closing_balance DECIMAL(12,2) NOT NULL,
    gateway_txn_id VARCHAR(100) NULL,
    status ENUM('pending', 'success', 'failed') DEFAULT 'success',
    remarks VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wallet_id) REFERENCES wallets(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL,
    INDEX idx_txn_user (user_id),
    INDEX idx_txn_created (created_at)
);

-- 10. Withdrawal Payout Requests
CREATE TABLE IF NOT EXISTS withdrawal_requests (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    req_no VARCHAR(30) UNIQUE NOT NULL,
    user_id BIGINT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_mode ENUM('upi', 'bank_transfer') NOT NULL,
    account_holder_name VARCHAR(100) NOT NULL,
    bank_name VARCHAR(100) NULL,
    account_no VARCHAR(50) NULL,
    ifsc_code VARCHAR(20) NULL,
    upi_id VARCHAR(50) NULL,
    status ENUM('pending', 'manager_verified', 'approved', 'rejected', 'processed') DEFAULT 'pending',
    rejection_reason VARCHAR(255) NULL,
    utr_no VARCHAR(100) NULL,
    verified_by BIGINT NULL,
    processed_by BIGINT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    verified_at TIMESTAMP NULL,
    processed_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (verified_by) REFERENCES users(id),
    FOREIGN KEY (processed_by) REFERENCES users(id)
);

-- 11. Complaints & Helpdesk Tickets
CREATE TABLE IF NOT EXISTS complaints (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    ticket_no VARCHAR(30) UNIQUE NOT NULL,
    application_id BIGINT NULL,
    raised_by BIGINT NOT NULL,
    subject VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    attachment_path VARCHAR(500) NULL,
    status ENUM('open', 'in_review', 'resolved', 'closed') DEFAULT 'open',
    resolution_note TEXT NULL,
    resolved_by BIGINT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP NULL,
    FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL,
    FOREIGN KEY (raised_by) REFERENCES users(id),
    FOREIGN KEY (resolved_by) REFERENCES users(id)
);

-- 12. User Action Requests (Agent Delete Request, etc.)
CREATE TABLE IF NOT EXISTS user_requests (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    requested_by BIGINT NOT NULL,
    target_user_id BIGINT NULL,
    request_type ENUM('delete_agent', 'add_agent', 'add_operator', 'other') NOT NULL,
    data_payload JSON NULL,
    reason TEXT NOT NULL,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    reviewed_by BIGINT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP NULL,
    FOREIGN KEY (requested_by) REFERENCES users(id),
    FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

-- 13. Dedicated Shops Registry Table
CREATE TABLE IF NOT EXISTS shops (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    shop_id_code VARCHAR(50) UNIQUE NOT NULL,
    user_id BIGINT UNIQUE NULL,
    owner_name VARCHAR(100) NOT NULL,
    shop_name VARCHAR(150) NOT NULL,
    mobile VARCHAR(15) UNIQUE NOT NULL,
    email VARCHAR(100) NULL,
    aadhaar_number VARCHAR(16) NULL,
    full_address TEXT NULL,
    district VARCHAR(100) NULL,
    tehsil VARCHAR(100) NULL,
    ward_no VARCHAR(50) NULL,
    distributor_id BIGINT NULL,
    status ENUM('pending', 'active', 'rejected', 'delete_requested') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (distributor_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 14. Operator Price Update Requests Table
CREATE TABLE IF NOT EXISTS operator_price_requests (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    request_no VARCHAR(50) UNIQUE NOT NULL,
    operator_id BIGINT NOT NULL,
    sub_service_id INT NOT NULL,
    assignment_id BIGINT NULL,
    routing_mode ENUM('single', 'area_wise', 'ward_wise') DEFAULT 'single',
    area_or_ward_label VARCHAR(150) NULL,
    current_price DECIMAL(10,2) NOT NULL,
    requested_price DECIMAL(10,2) NOT NULL,
    reason TEXT NULL,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    admin_remarks TEXT NULL,
    reviewed_by BIGINT NULL,
    reviewed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (operator_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (sub_service_id) REFERENCES sub_services(id) ON DELETE CASCADE,
    FOREIGN KEY (assignment_id) REFERENCES operator_assignments(id) ON DELETE SET NULL,
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);
