const express = require('express');
const app = express();
require('dotenv').config();
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
// email sender
const nodemailer = require("nodemailer");
const port = process.env.PORT || 8000;

// middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(cookieParser());

// send email
const sendEmail = async (emailAddress, emailData) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    // host: "smtp.ethereal.email",
    host: "smtp.gmail.email",
    port: 587,
    secure: false, // Use `true` for port 465, `false` for all other ports
    auth: {
      user: `${process.env.TRANSPORTER_EMAIL}`,
      //remember the password is not the gmail password
      pass: `${process.env.TRANSPORTER_PASS}`,
    },
  });
  // sending email
  const mailBody = {
    from: `"StayVista 👌" ${process.env.TRANSPORTER_EMAIL}`, // sender address
    to: emailAddress,// list of receivers
    subject: emailData.subject, // Subject line
    // text: "Hello world?", // plain text body
    html: emailData.message, // html body
  };
  // send mail with defined transport object
  const info = transporter.sendMail(mailBody, (error, info) => {
    if (error) {
      console.log(error);
    } else {
      console.log('Email Sent : ', info.response);
    }
  });

  console.log("Message sent: %s", info.messageId);
  // Message sent: <d786aa62-4e0a-070a-47ed-0b0666549519@ethereal.email>
};

// Verify Token Middleware
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: 'unauthorized access' });
    }
    req.user = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.qvjjrvn.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})

async function run() {
  try {
    const roomsCollection = client.db('stayVistaHotel').collection('rooms');
    const usersCollection = client.db('stayVistaHotel').collection('users');
    const bookingsCollection = client.db('stayVistaHotel').collection('bookings');

    // verify admin middleware
    const verifyAdmin = async (req, res, next) => {
      const user = req.user;
      const query = { email: user?.email };
      const result = await usersCollection.findOne(query);
      console.log(result.role);
      if (!result || result?.role !== 'admin') {
        return res.status(401).send({ message: 'unauthorized access!!! jni na ' })
      }
      next();
    }
    // verify host middleware
    const verifyHost = async (req, res, next) => {
      const user = req.user;
      const query = { email: user?.email };
      const result = await usersCollection.findOne(query);
      console.log(result.role);
      if (!result || result?.role !== 'host') {
        return res.status(401).send({ message: 'unauthorized access!!!' })
      }
      next();
    }

    // auth related api
    app.post('/jwt', async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '365d', })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    });

    // Logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
        console.log('Logout successful')
      } catch (err) {
        res.status(500).send(err)
      }
    });
    // save a user data in db
    app.put('/user', async (req, res) => {
      const user = req.body;
      const query = { email: user?.email };
      // check if user all ready exists in db
      const isExists = await usersCollection.findOne(query);
      // if status is requested
      if (isExists) {
        if (user?.status === 'Requested') {
          // if existing user try to change his role
          const result = await usersCollection.updateOne(query,
            { $set: { status: user?.status } }
          );
          return res.send(result);
        }
        else {
          // if user exists return the user data
          // if existing user login again
          return res.send(isExists);
        }
      }
      // save user for the first time
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          ...user,
          timestamp: new Date(),
        },
      };
      const result = await usersCollection.updateOne(query, updateDoc, options);
      res.send(result);
    });
    //  get a user info by email from db
    app.get('/user/:email', async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send(result);
    })

    //get all users data from db
    app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // update the user role in db
    app.patch('/user/update/:email', async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query = { email: email };
      const updateDoc = {
        $set: { ...user, timestamp: Date.now() }// remember in the $set we cannot write new Date()
      };
      const result = await usersCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // Save a room data in db
    app.post('/room', verifyToken, verifyHost, async (req, res) => {
      const room = req.body;
      const result = await roomsCollection.insertOne(room);
      res.send(result);
    });

    // Get all rooms from db
    app.get('/rooms', async (req, res) => {
      const category = req.query.category;
      let query = {};
      if (category && category !== 'null') query = { category };
      const result = await roomsCollection.find(query).toArray();
      res.send(result);
    });
    // get all rooms for host
    app.get('/my-listings/:email', verifyToken, verifyHost, async (req, res) => {
      const email = req.params.email;
      const query = { 'host.email': email };
      const result = await roomsCollection.find(query).toArray();
      res.send(result);
    });

    // delete room
    app.delete('/room/:id', verifyToken, verifyHost, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await roomsCollection.deleteOne(query);
      res.send(result);
    });

    // Get single room data from db using id
    app.get('/room/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await roomsCollection.findOne(query);
      res.send(result);
    });

    // create stripe api
    app.post('/create-payment-intent', verifyToken, async (req, res) => {
      const price = req.body.price;
      const priceInCent = parseFloat(price * 100);

      // generate client secret 
      // send client secret as response
      if (!price || priceInCent < 1) return;

      const { client_secret } = await stripe.paymentIntents.create({
        amount: priceInCent,
        currency: 'usd',
        automatic_payment_methods: {
          enabled: true
        },
      });
      // send the client secret in the client side
      res.send({ client_secret: client_secret });
    });



    // Save a booking data in db
    app.post('/booking', verifyToken, async (req, res) => {
      const bookingData = req.body;
      const result = await bookingsCollection.insertOne(bookingData);
      // send email to the guest  
      await sendEmail(bookingData?.guest?.email, {
        subject: 'Booking Successfully',
        message: `You've successfully booked a room through stayVista. Transaction Id ${bookingData.transactionId}`
      });
      // send email to the host  
      await sendEmail(bookingData?.host?.email, {
        subject: 'Your room got Booked',
        message: `Get ready to welcome ${bookingData?.guest?.name}`
      });

      res.send(result); //updateRoom
    });

    // update room data 
    app.put('/room/update/:id', verifyToken, verifyHost, async (req, res) => {
      const roomData = req.body;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          ...roomData
        },
      };

      const result = await roomsCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // update a room status
    app.patch('/room/status/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const status = req.body.status;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          booked: status
        },
      };
      const updateRoom = await roomsCollection.updateOne(query, updateDoc);
      res.send(updateRoom);
    });

    // get all bookings for a guest
    app.get('/my-bookings/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { 'guest.email': email };
      const result = await bookingsCollection.find(query).toArray();
      res.send(result);
    });

    // delete a booking
    app.delete('/booking/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingsCollection.deleteOne(query);
      res.send(result);
    });

    // get all bookings for a guest
    app.get('/manage-bookings/:email', verifyToken, verifyHost, async (req, res) => {
      const email = req.params.email;
      const query = { 'host.email': email };
      const result = await bookingsCollection.find(query).toArray();
      res.send(result);
    });

    // Admin Statistic 
    app.get('/admin-stat', verifyToken, verifyAdmin, async (req, res) => {
      const bookingDetails = await bookingsCollection.find({}, {
        projection: {
          date: 1,
          price: 1,
        }
      }
      ).toArray();
      // making this type of data
      //   const data = [
      //     ['Day', 'Sales'],
      //     ['9', 1000],
      //     ['10', 1170],
      //     ['11', 660],
      //     ['12', 1030],
      // ];
      // console.log(bookingDetails);
      // total users
      const totalUsers = await usersCollection.estimatedDocumentCount();
      // total rooms
      const totalRooms = await roomsCollection.estimatedDocumentCount();
      // total price
      const totalSales = bookingDetails.reduce((acc, item) => (acc + item.price), 0);
      // chart data
      const chartData = bookingDetails?.map(booking => {
        const day = new Date(booking?.date).getDate();
        const months = new Date(booking.date).getMonth() + 1;
        const data = [`${day}/${months}`, booking?.price];
        return data;
      });

      chartData.unshift(['Days', 'Sales']);
      // chartData.splice(0, 0, ['day', 'sales'])

      res.send({ totalUsers, totalRooms, totalBookings: bookingDetails?.length, totalSales, chartData });
    });

    // host manage api created
    app.get('/manage-bookings/:email', verifyToken, verifyHost, async (req, res) => {
      const email = req.params.email;
      const query = { 'host.email': email };
      const result = await bookingsCollection.find(query).toArray();
      res.send(result);
    });

    // host Statistic verifyToken, verifyAdmin,
    app.get('/host-stat', verifyToken, verifyHost, async (req, res) => {
      const email = req?.user?.email;
      console.log(email);
      const bookingDetails = await bookingsCollection.find(
        {
          'host.email': email
        },
        {
          projection: {
            date: 1,
            price: 1,
          }
        }
      ).toArray();
      // making this type of data
      //   const data = [
      //     ['Day', 'Sales'],
      //     ['9', 1000],
      //     ['10', 1170],
      //     ['11', 660],
      //     ['12', 1030],
      // ];
      // total rooms
      const totalRooms = await roomsCollection.estimatedDocumentCount({ 'host.email': email });
      // total price
      const totalSales = bookingDetails.reduce((acc, item) => (acc + item.price), 0);
      // make a host time
      const { timestamp } = await usersCollection.findOne({ email: email },
        {
          projection: {
            timestamp: 1
          }
        });

      // chart data
      const chartData = bookingDetails?.map(booking => {
        const day = new Date(booking?.date).getDate();
        const months = new Date(booking.date).getMonth() + 1;
        const data = [`${day}/${months}`, booking?.price];
        return data;
      });

      chartData.unshift(['Days', 'Sales']);
      // chartData.splice(0, 0, ['day', 'sales'])

      res.send({
        totalRooms, totalBookings: bookingDetails?.length, totalSales,
        hostSince: timestamp, chartData
      });
    });

    // guest Statistic verifyToken, verifyAdmin,
    app.get('/guest-stat', verifyToken, async (req, res) => {
      const email = req?.user?.email;
      console.log(email);
      const bookingDetails = await bookingsCollection.find(
        {
          'guest.email': email
        },
        {
          projection: {
            date: 1,
            price: 1,
          }
        }
      ).toArray();
      // making this type of data
      //   const data = [
      //     ['Day', 'Sales'],
      //     ['9', 1000],
      //     ['10', 1170],
      //     ['11', 660],
      //     ['12', 1030],
      // ];
      // total price
      const totalSales = bookingDetails.reduce((acc, item) => (acc + item.price), 0);
      // make a host time
      const { timestamp } = await usersCollection.findOne({ email: email },
        {
          projection: {
            timestamp: 1
          }
        });
      // chart data
      const chartData = bookingDetails?.map(booking => {
        const day = new Date(booking?.date).getDate();
        const months = new Date(booking.date).getMonth() + 1;
        const data = [`${day}/${months}`, booking?.price];
        return data;
      });

      chartData.unshift(['Days', 'Sales']);
      // chartData.splice(0, 0, ['day', 'sales'])

      res.send({ totalBookings: bookingDetails?.length, totalSales, guestSince: timestamp, chartData });
    });
    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Hello from StayVista Server..');
});

app.listen(port, () => {
  console.log(`StayVista is running on port ${port}`);
});

// change room availability 
// const roomId = bookingData?.roomId;
// const query = { _id: new ObjectId(roomId) };
// const updateDoc = {
//   $set: {
//     booked: true
//   },
// };
// const updateRoom = await roomsCollection.updateOne(query, updateDoc);
// console.log(updateRoom);