const express = require("express");
const path = require("path");
const sql = require("mssql");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "FLUX-main")));

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT),
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

async function connectDB() {
    try {
        await sql.connect(config);
        console.log("Connected to FLUX_DB!");
    } catch (error) {
        console.log("Database connection error:", error);
    }
}

// TEST CONNECTION
app.get("/api/test", async (req, res) => {
    try {
        const result = await sql.query("SELECT DB_NAME() AS DatabaseName");
        res.json(result.recordset[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET MENU
app.get("/api/menu", async (req, res) => {
    try {
        const result = await sql.query(
            "SELECT * FROM Menu WHERE Availability = 'Available'"
        );

        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET EMPLOYEES
app.get("/api/employees", async (req, res) => {
    try {
        const result = await sql.query(
            "SELECT * FROM Employee WHERE Status = 'Active'"
        );

        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET RESERVATIONS
app.get("/api/reservations", async (req, res) => {
    try {
        const result = await sql.query(`
            SELECT r.*, e.EmployeeName
            FROM Reservation r
            LEFT JOIN Employee e
            ON r.EmployeeID = e.EmployeeID
            ORDER BY r.ReservationID DESC
        `);

        res.json(result.recordset);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// SAVE RESERVATION
app.post("/api/reservations", async (req, res) => {
    try {
        const {
            customerName,
            guestCount,
            tableCode,
            tableType,
            reservationDate,
            reservationTime,
            reservationFee,
            paymentMethod
        } = req.body;

        if (
            !customerName ||
            !Number.isInteger(Number(guestCount)) ||
            Number(guestCount) < 1 ||
            !tableCode ||
            !tableType ||
            !reservationDate ||
            !reservationTime ||
            !paymentMethod
        ) {
            return res.status(400).json({
                message: "Please complete all required fields."
            });
        }

        const referenceNo = "FLX-" +
            require("crypto").randomBytes(4).toString("hex").toUpperCase();

        const request = new sql.Request();

        request.input("ReferenceNo", sql.VarChar(20), referenceNo);
        request.input("CustomerName", sql.VarChar(100), customerName);
        request.input("GuestCount", sql.Int, Number(guestCount));
        request.input("TableCode", sql.VarChar(30), tableCode);
        request.input("TableType", sql.VarChar(50), tableType);
        const parsedDate = new Date(reservationDate + "T00:00:00.000Z");

if (isNaN(parsedDate.getTime())) {
    return res.status(400).json({
        message: "Invalid reservation date."
    });
}

request.input("ReservationDate", sql.Date, parsedDate);
        request.input("ReservationTime", sql.VarChar(8), reservationTime);
        request.input("ReservationFee", sql.Decimal(10, 2), Number(reservationFee));
        request.input("PaymentMethod", sql.VarChar(30), paymentMethod);

        const result = await request.query(`
            INSERT INTO Reservation
            (
                ReferenceNo, CustomerName, GuestCount,
                TableCode, TableType, ReservationDate,
                ReservationTime, ReservationFee,
                PaymentMethod, Status
            )
            OUTPUT INSERTED.ReservationID,
                   INSERTED.ReferenceNo
            VALUES
            (
                @ReferenceNo, @CustomerName, @GuestCount,
                @TableCode, @TableType, @ReservationDate,
                @ReservationTime, @ReservationFee,
                @PaymentMethod, 'Pending'
            )
        `);

        res.status(201).json({
            message: "Reservation saved successfully!",
            reservation: result.recordset[0]
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


/* ================================
   MENU MANAGEMENT
================================ */

// ADD MENU ITEM
app.post("/api/menu", async (req, res) => {
    try {
        const { itemName, description, category, price } = req.body;

        if (!itemName || !category || price === undefined || !Number.isFinite(Number(price)) || Number(price) < 0) {
            return res.status(400).json({ message: "Please provide a valid name, category, and price." });
        }

        const result = await new sql.Request()
            .input("ItemName", sql.VarChar(100), itemName)
            .input("Description", sql.VarChar(255), description || "")
            .input("Category", sql.VarChar(50), category)
            .input("Price", sql.Decimal(10, 2), Number(price))
            .query(`
                INSERT INTO Menu (ItemName, Description, Category, Price, Availability)
                OUTPUT INSERTED.*
                VALUES (@ItemName, @Description, @Category, @Price, 'Available')
            `);

        res.status(201).json({
            message: "Menu item added successfully!",
            item: result.recordset[0]
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// EDIT MENU ITEM
app.put("/api/menu/:id", async (req, res) => {
    try {
        const { itemName, description, category, price, availability } = req.body;
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id < 1 || !itemName || !category || price === undefined || !Number.isFinite(Number(price)) || Number(price) < 0) {
            return res.status(400).json({ message: "Invalid menu item details." });
        }

        const result = await new sql.Request()
            .input("MenuID", sql.Int, id)
            .input("ItemName", sql.VarChar(100), itemName)
            .input("Description", sql.VarChar(255), description || "")
            .input("Category", sql.VarChar(50), category)
            .input("Price", sql.Decimal(10, 2), Number(price))
            .input("Availability", sql.VarChar(20), availability || "Available")
            .query(`
                UPDATE Menu
                SET ItemName = @ItemName,
                    Description = @Description,
                    Category = @Category,
                    Price = @Price,
                    Availability = @Availability
                WHERE MenuID = @MenuID;

                SELECT @@ROWCOUNT AS Affected;
            `);

        if (!result.recordset[0].Affected) {
            return res.status(404).json({ message: "Menu item not found." });
        }

        res.json({ message: "Menu item updated successfully!" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE MENU ITEM
app.delete("/api/menu/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id < 1) {
            return res.status(400).json({ message: "Invalid menu item ID." });
        }

        const result = await new sql.Request()
            .input("MenuID", sql.Int, id)
            .query(`
                DELETE FROM Menu WHERE MenuID = @MenuID;
                SELECT @@ROWCOUNT AS Affected;
            `);

        if (!result.recordset[0].Affected) {
            return res.status(404).json({ message: "Menu item not found." });
        }

        res.json({ message: "Menu item deleted successfully!" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


/* ================================
   EMPLOYEE MANAGEMENT
================================ */

// ADD EMPLOYEE
app.post("/api/employees", async (req, res) => {
    try {
        const { employeeName, position, contactNumber, email } = req.body;

        if (!employeeName || !position) {
            return res.status(400).json({ message: "Employee name and position are required." });
        }

        const result = await new sql.Request()
            .input("EmployeeName", sql.VarChar(100), employeeName)
            .input("Position", sql.VarChar(50), position)
            .input("ContactNumber", sql.VarChar(20), contactNumber || "")
            .input("Email", sql.VarChar(100), email || "")
            .query(`
                INSERT INTO Employee
                    (EmployeeName, Position, ContactNumber, Email, Status)
                OUTPUT INSERTED.*
                VALUES
                    (@EmployeeName, @Position, @ContactNumber, @Email, 'Active')
            `);

        res.status(201).json({
            message: "Employee added successfully!",
            employee: result.recordset[0]
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// EDIT EMPLOYEE
app.put("/api/employees/:id", async (req, res) => {
    try {
        const { employeeName, position, contactNumber, email, status } = req.body;
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id < 1 || !employeeName || !position) {
            return res.status(400).json({ message: "Invalid employee details." });
        }

        const result = await new sql.Request()
            .input("EmployeeID", sql.Int, id)
            .input("EmployeeName", sql.VarChar(100), employeeName)
            .input("Position", sql.VarChar(50), position)
            .input("ContactNumber", sql.VarChar(20), contactNumber || "")
            .input("Email", sql.VarChar(100), email || "")
            .input("Status", sql.VarChar(20), status || "Active")
            .query(`
                UPDATE Employee
                SET EmployeeName = @EmployeeName,
                    Position = @Position,
                    ContactNumber = @ContactNumber,
                    Email = @Email,
                    Status = @Status
                WHERE EmployeeID = @EmployeeID;

                SELECT @@ROWCOUNT AS Affected;
            `);

        if (!result.recordset[0].Affected) {
            return res.status(404).json({ message: "Employee not found." });
        }

        res.json({ message: "Employee updated successfully!" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE EMPLOYEE
app.delete("/api/employees/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id < 1) {
            return res.status(400).json({ message: "Invalid employee ID." });
        }

        const result = await new sql.Request()
            .input("EmployeeID", sql.Int, id)
            .query(`
                DELETE FROM Employee WHERE EmployeeID = @EmployeeID;
                SELECT @@ROWCOUNT AS Affected;
            `);

        if (!result.recordset[0].Affected) {
            return res.status(404).json({ message: "Employee not found." });
        }

        res.json({ message: "Employee deleted successfully!" });
    } catch (error) {
        res.status(500).json({
            message: "Unable to delete employee. They may be assigned to a reservation.",
            error: error.message
        });
    }
});


/* ================================
   RESERVATION MANAGEMENT
================================ */

// UPDATE RESERVATION STATUS
app.patch("/api/reservations/:id/status", async (req, res) => {
    try {
        const id = Number(req.params.id);
        const { status } = req.body;

        const allowedStatuses = ["Pending", "Confirmed", "Cancelled"];

        if (!Number.isInteger(id) || id < 1 || !allowedStatuses.includes(status)) {
            return res.status(400).json({ message: "Invalid reservation ID or status." });
        }

        const result = await new sql.Request()
            .input("ReservationID", sql.Int, id)
            .input("Status", sql.VarChar(30), status)
            .query(`
                UPDATE Reservation
                SET Status = @Status
                WHERE ReservationID = @ReservationID;

                SELECT @@ROWCOUNT AS Affected;
            `);

        if (!result.recordset[0].Affected) {
            return res.status(404).json({ message: "Reservation not found." });
        }

        res.json({ message: "Reservation status updated successfully!" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// START SERVER
async function startServer() {
    try {
        await sql.connect(config);
        console.log("Connected to FLUX_DB!");

        app.listen(process.env.PORT || 3000, () => {
            console.log("FLUX server running at http://localhost:3000");
        });
    } catch (error) {
        console.log("Cannot connect to SQL Server:", error.message);
    }
}

startServer();
